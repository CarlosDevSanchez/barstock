import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import type { ProductCreate, ProductsQuery, ProductUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { assertMoneyScale, searchFilter, type Page } from './_shared'

export type ProductListItem = Tables<'products'> & {
    category: Pick<Tables<'categories'>, 'id' | 'name'> | null
    /** Units in stock (product-level inventory row); null when the product has no inventory row. */
    stock: number | null
}

const LIST_SELECT = '*, category:categories(id, name), inventory(quantity, variant_id)'

export async function listProducts(
    supabase: AppSupabaseClient,
    { page, pageSize, q, category_id, active, ids }: ProductsQuery
): Promise<Page<ProductListItem>> {
    // `.order('id')` after name breaks ties deterministically: without it, offset pagination can duplicate or skip
    // rows whenever two products share a name (or Postgres returns equal-name rows in a different order per page).
    let query = supabase
        .from('products')
        .select(LIST_SELECT, { count: 'exact' })
        .is('deleted_at', null)
        .order('name')
        .order('id')
    const filter = searchFilter(q, ['name', 'sku', 'barcode'])
    if (filter) query = query.or(filter)
    if (category_id) query = query.eq('category_id', category_id)
    if (active !== undefined) query = query.eq('is_active', active)
    if (ids) query = query.in('id', ids)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)

    const rows = data.map(({ inventory, ...product }) => ({
        ...product,
        stock: inventory.find(row => row.variant_id === null)?.quantity ?? null
    }))
    return { rows, total: count ?? 0 }
}

export interface TopProduct {
    product_id: string
    name: string
    selling_price: number
    /** Units in stock right now (product-level row); null when the product has no inventory row. */
    stock: number | null
    category_name: string | null
    /** Units sold in the window, excluding refunded orders. */
    quantity: number
}

/** Store-wide best sellers of the last `days` days (mode of sale), for the POS quick-sell panel. */
export async function listTopProducts(supabase: AppSupabaseClient, days = 30, limit = 5): Promise<TopProduct[]> {
    const { data, error } = await supabase.rpc('top_selling_products', { p_days: days, p_limit: limit })
    assertNoError(error)
    return data
}

export async function getProduct(supabase: AppSupabaseClient, id: string): Promise<Tables<'products'>> {
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Product not found')
    return data
}

export async function createProduct(supabase: AppSupabaseClient, input: ProductCreate): Promise<Tables<'products'>> {
    await assertMoneyScale(supabase, { cost_price: input.cost_price, selling_price: input.selling_price })
    const { data, error } = await supabase.from('products').insert(input).select().single()
    assertNoError(error)
    return data
}

export async function updateProduct(
    supabase: AppSupabaseClient,
    id: string,
    patch: ProductUpdate
): Promise<Tables<'products'>> {
    await assertMoneyScale(supabase, { cost_price: patch.cost_price, selling_price: patch.selling_price })
    // RLS turns a forbidden or missing row into "0 rows", not an error: maybeSingle + notFound covers both.
    const { data, error } = await supabase
        .from('products')
        .update(patch)
        .eq('id', id)
        .is('deleted_at', null)
        .select()
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Product not found')
    return data
}

/** Soft delete: order history keeps pointing at the product. The SKU stays reserved. */
export async function deleteProduct(supabase: AppSupabaseClient, id: string): Promise<void> {
    const { data, error } = await supabase
        .from('products')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Product not found')
}
