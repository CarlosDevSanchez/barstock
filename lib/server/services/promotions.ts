import 'server-only'
import { AppError, assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import type { PromotionCreate, PromotionsQuery, PromotionUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { packagesAvailable } from '@/lib/promotion-allocate'
import { assertMoneyScale, searchFilter, type Page } from './_shared'

export type PromotionItemRow = Pick<Tables<'promotion_items'>, 'id' | 'product_id' | 'quantity'> & {
    product:
        | (Pick<Tables<'products'>, 'id' | 'name' | 'is_active' | 'deleted_at' | 'selling_price' | 'tax_rate'> & {
              stock: number | null
          })
        | null
}

export type PromotionListItem = Tables<'promotions'> & {
    items: PromotionItemRow[]
    /** Packages sellable from component stock; null if any component lacks an inventory row. */
    available: number | null
}

const LIST_SELECT =
    '*, items:promotion_items(id, product_id, quantity, product:products(id, name, is_active, deleted_at, selling_price, tax_rate, inventory(quantity, variant_id)))'

type RawPromotionRow = Tables<'promotions'> & {
    items: Array<{
        id: string
        product_id: string
        quantity: number
        product:
            | (Pick<Tables<'products'>, 'id' | 'name' | 'is_active' | 'deleted_at' | 'selling_price' | 'tax_rate'> & {
                  inventory: Array<{ quantity: number; variant_id: string | null }>
              })
            | null
    }> | null
}

function mapPromotionRow(row: RawPromotionRow): PromotionListItem {
    const items: PromotionItemRow[] = (row.items ?? []).map(({ product, ...item }) => {
        if (!product) return { ...item, product: null }
        const { inventory, ...rest } = product
        return {
            ...item,
            product: {
                ...rest,
                stock: inventory.find(inv => inv.variant_id === null)?.quantity ?? null
            }
        }
    })
    const sellable = items.length > 0 && items.every(i => i.product?.is_active && i.product.deleted_at === null)
    const available = sellable
        ? packagesAvailable(items.map(i => ({ quantity: i.quantity, stock: i.product!.stock })))
        : 0
    const { items: _raw, ...promo } = row
    return { ...promo, items, available }
}

async function assertProductsUsable(supabase: AppSupabaseClient, productIds: string[]): Promise<void> {
    const unique = [...new Set(productIds)]
    const { data, error } = await supabase.from('products').select('id').in('id', unique).is('deleted_at', null)
    assertNoError(error)
    if ((data?.length ?? 0) !== unique.length) {
        throw new AppError('validation_failed', 'The request is not valid', [
            { path: 'items', message: 'validation.unknownProduct' }
        ])
    }
}

async function replaceItems(
    supabase: AppSupabaseClient,
    promotionId: string,
    items: PromotionCreate['items']
): Promise<void> {
    await assertProductsUsable(
        supabase,
        items.map(item => item.product_id)
    )
    const { error: deleteError } = await supabase.from('promotion_items').delete().eq('promotion_id', promotionId)
    assertNoError(deleteError)
    const { error: insertError } = await supabase
        .from('promotion_items')
        .insert(
            items.map(item => ({ promotion_id: promotionId, product_id: item.product_id, quantity: item.quantity }))
        )
    assertNoError(insertError)
}

export async function listPromotions(
    supabase: AppSupabaseClient,
    { page, pageSize, q, active, ids }: PromotionsQuery
): Promise<Page<PromotionListItem>> {
    let query = supabase
        .from('promotions')
        .select(LIST_SELECT, { count: 'exact' })
        .is('deleted_at', null)
        .order('name')
        .order('id')
    const filter = searchFilter(q, ['name'])
    if (filter) query = query.or(filter)
    if (active !== undefined) query = query.eq('is_active', active)
    if (ids) query = query.in('id', ids)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)

    return {
        rows: data.map(row => mapPromotionRow(row)),
        total: count ?? 0
    }
}

export async function getPromotion(supabase: AppSupabaseClient, id: string): Promise<PromotionListItem> {
    const { data, error } = await supabase
        .from('promotions')
        .select(LIST_SELECT)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Promotion not found')
    return mapPromotionRow(data)
}

export async function createPromotion(supabase: AppSupabaseClient, input: PromotionCreate): Promise<PromotionListItem> {
    await assertMoneyScale(supabase, { package_price: input.package_price })
    const { items, ...promo } = input
    await assertProductsUsable(
        supabase,
        items.map(item => item.product_id)
    )

    const { data, error } = await supabase.from('promotions').insert(promo).select('id').single()
    assertNoError(error)

    const { error: itemsError } = await supabase
        .from('promotion_items')
        .insert(items.map(item => ({ promotion_id: data.id, product_id: item.product_id, quantity: item.quantity })))
    if (itemsError) {
        // Soft-delete the orphan: promotions have no DELETE policy (history FK).
        await supabase
            .from('promotions')
            .update({ deleted_at: new Date().toISOString(), is_active: false })
            .eq('id', data.id)
        assertNoError(itemsError)
    }

    return getPromotion(supabase, data.id)
}

export async function updatePromotion(
    supabase: AppSupabaseClient,
    id: string,
    patch: PromotionUpdate
): Promise<PromotionListItem> {
    const { items, ...fields } = patch
    await assertMoneyScale(supabase, { package_price: fields.package_price })

    if (Object.keys(fields).length > 0) {
        const { data, error } = await supabase
            .from('promotions')
            .update(fields)
            .eq('id', id)
            .is('deleted_at', null)
            .select('id')
            .maybeSingle()
        assertNoError(error)
        if (!data) throw notFound('Promotion not found')
    } else {
        // Confirm the row exists before optionally replacing items.
        const { data, error } = await supabase
            .from('promotions')
            .select('id')
            .eq('id', id)
            .is('deleted_at', null)
            .maybeSingle()
        assertNoError(error)
        if (!data) throw notFound('Promotion not found')
    }

    if (items) await replaceItems(supabase, id, items)
    return getPromotion(supabase, id)
}

/** Soft delete: order history may still point at the promotion via order_items.promotion_id. */
export async function deletePromotion(supabase: AppSupabaseClient, id: string): Promise<void> {
    const { data, error } = await supabase
        .from('promotions')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Promotion not found')
}
