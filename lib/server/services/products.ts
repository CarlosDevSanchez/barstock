import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import { trySignedGetUrl } from '@/lib/server/storage'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import { effectiveStock, type StockMode } from '@/lib/stock'
import type { ProductCreate, ProductsQuery, ProductUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { assertMoneyScale, searchFilter, type Page } from './_shared'

// `image_url` is the legacy, unused column (kept in the DB, never written again); `image_key` is never sent to the
// client (lib/server/storage.ts: "don't let the client see or choose an object key") — only the signed URL is.
export type ProductListItem = Omit<Tables<'products'>, 'image_url' | 'image_key' | 'stock_mode'> & {
    category: Pick<Tables<'categories'>, 'id' | 'name'> | null
    stock_mode: StockMode
    /** Whole sellable units: its own row, or floor(base / stock_units) for a presentation; null when untracked. */
    stock: number | null
    /** Units on the row it sells from (the base for a presentation); null when untracked. */
    stock_base_quantity: number | null
    /** The base product of a presentation (`stock_mode = 'linked'`), else null. */
    stock_base: { id: string; name: string } | null
    /** Signed R2 URL for image_key (1h TTL), or null when there is no image or storage is not configured. */
    image_url: string | null
}

/** Return shape of `getProduct`: same `image_url` mapping as the list, but `image_key` stays (the image upload/
 * delete route needs it to find the previous object to replace). */
export type ProductDetail = Omit<Tables<'products'>, 'image_url'> & { image_url: string | null }

/** Shared with `getPosSnapshot` (lib/server/services/pos.ts), so both return the same row shape. */
export const LIST_SELECT =
    '*, category:categories(id, name), inventory(quantity, variant_id), stock_base:stock_product_id(id, name)'

type InventoryRows = Array<{ quantity: number; variant_id: string | null }>
const productRowQuantity = (rows: InventoryRows) => rows.find(row => row.variant_id === null)?.quantity ?? null

/**
 * Units on the stock rows of the given base products (presentations sell from them). PostgREST's typed embeds
 * cannot reach a base's inventory through the self-reference, so this is one extra query, skipped when empty.
 */
export async function baseStockQuantities(
    supabase: AppSupabaseClient,
    baseIds: readonly string[]
): Promise<Map<string, number>> {
    const quantities = new Map<string, number>()
    const unique = [...new Set(baseIds)]
    if (unique.length === 0) return quantities
    const { data, error } = await supabase
        .from('inventory')
        .select('product_id, quantity')
        .in('product_id', unique)
        .is('variant_id', null)
    assertNoError(error)
    for (const row of data) quantities.set(row.product_id, row.quantity)
    return quantities
}

type MappedProduct<T> = Omit<T, 'inventory' | 'stock_mode' | 'image_url' | 'image_key'> & {
    stock_mode: StockMode
    stock: number | null
    stock_base_quantity: number | null
    image_url: string | null
}

/**
 * Turns raw `LIST_SELECT` rows into `ProductListItem`s: stock derived from the product's own row, or from its base's
 * row for a presentation (one extra query, only when the page has presentations), image key swapped for a signed URL.
 */
export async function mapProductRows<
    T extends {
        inventory: InventoryRows
        stock_base: { id: string; name: string } | null
        stock_mode: string
        stock_units: number
        image_url: string | null
        image_key: string | null
    }
>(supabase: AppSupabaseClient, data: T[]): Promise<Array<MappedProduct<T>>> {
    const baseQuantity = await baseStockQuantities(
        supabase,
        data.flatMap(row => (row.stock_mode === 'linked' && row.stock_base ? [row.stock_base.id] : []))
    )

    return Promise.all(
        data.map(async ({ inventory, image_url: _legacy, image_key, ...product }) => {
            const mode = product.stock_mode as StockMode
            const base =
                mode === 'none'
                    ? null
                    : mode === 'linked'
                      ? (baseQuantity.get(product.stock_base?.id ?? '') ?? null)
                      : productRowQuantity(inventory)
            // TS cannot see through a spread of a generic that `stock_mode` is overridden, hence the assertion.
            const mapped = {
                ...product,
                stock_mode: mode,
                stock: effectiveStock(mode, base, product.stock_units),
                stock_base_quantity: base,
                image_url: await trySignedGetUrl(image_key)
            } as MappedProduct<T>
            return mapped
        })
    )
}

export async function listProducts(
    supabase: AppSupabaseClient,
    { page, pageSize, q, category_id, active, ids, stock_mode }: ProductsQuery
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
    if (stock_mode) query = query.in('stock_mode', stock_mode)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)

    const rows = await mapProductRows(supabase, data)
    return { rows, total: count ?? 0 }
}

export interface TopProduct {
    product_id: string
    name: string
    selling_price: number
    /** Whole sellable units right now (see ProductListItem.stock); null when untracked or without a row. */
    stock: number | null
    category_name: string | null
    /** Units sold in the window, excluding refunded orders. */
    quantity: number
    stock_mode: StockMode
    stock_product_id: string | null
    stock_units: number
    stock_base_quantity: number | null
}

/** Store-wide best sellers of the last `days` days (mode of sale), for the POS quick-sell panel. */
export async function listTopProducts(supabase: AppSupabaseClient, days = 30, limit = 5): Promise<TopProduct[]> {
    const { data, error } = await supabase.rpc('top_selling_products', { p_days: days, p_limit: limit })
    assertNoError(error)
    return data.map(row => ({ ...row, stock_mode: row.stock_mode as StockMode }))
}

export async function getProduct(supabase: AppSupabaseClient, id: string): Promise<ProductDetail> {
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Product not found')
    const { image_url: _legacy, ...product } = data
    return { ...product, image_url: await trySignedGetUrl(data.image_key) }
}

export async function createProduct(supabase: AppSupabaseClient, input: ProductCreate): Promise<Tables<'products'>> {
    await assertMoneyScale(supabase, { cost_price: input.cost_price, selling_price: input.selling_price })
    const { low_stock_threshold: threshold, ...row } = input
    const { data, error } = await supabase.from('products').insert(row).select().single()
    assertNoError(error)
    if (threshold !== undefined) {
        const { data: inventory, error: inventoryError } = await supabase
            .from('inventory')
            .select('id')
            .eq('product_id', data.id)
            .is('variant_id', null)
            .maybeSingle()
        assertNoError(inventoryError)
        if (!inventory) throw notFound('Inventory not found')
        const { error: thresholdError } = await supabase.rpc('set_low_stock_threshold', {
            p_inventory_id: inventory.id,
            p_threshold: threshold
        })
        assertNoError(thresholdError)
    }
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

/**
 * Sets or clears `image_key`. Only called from app/api/v1/products/[id]/image/route.ts, after the file has already
 * been validated and uploaded: the key never comes from a client-supplied body (productUpdateSchema has no such
 * field).
 */
export async function setProductImage(
    supabase: AppSupabaseClient,
    id: string,
    imageKey: string | null
): Promise<Tables<'products'>> {
    const { data, error } = await supabase
        .from('products')
        .update({ image_key: imageKey })
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
