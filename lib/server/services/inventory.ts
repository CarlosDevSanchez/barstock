import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import type { InventoryQuery } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { searchFilter, type Page } from './_shared'

export type InventoryListItem = Tables<'inventory'> & {
    product: Pick<Tables<'products'>, 'id' | 'name' | 'sku' | 'cost_price'>
    variant: Pick<Tables<'product_variants'>, 'id' | 'name'> | null
    /** Presentations that sell from this row (a box × 15 of these singles), largest first. */
    presentations: Array<Pick<Tables<'products'>, 'id' | 'name' | 'stock_units'>>
}

export interface InventorySummary {
    /** Units in stock across everything that matches the search (not just this page). */
    total_units: number
    item_count: number
    /** Items at or below their own threshold. */
    low_stock_count: number
    /** Σ quantity × cost price. */
    stock_value: number
}

const SELECT =
    '*, product:products!inner(id, name, sku, cost_price, deleted_at, stock_mode), variant:product_variants(id, name)'
// Small business: the whole inventory fits comfortably; PostgREST caps a response at 1000 rows anyway.
const SUMMARY_LIMIT = 1000

/**
 * "Low stock" compares two columns of the same row (quantity <= low_stock_threshold), which PostgREST filters cannot
 * express, so the summary is computed over the matching rows and the low-stock listing is filtered in memory.
 */
export async function listInventory(
    supabase: AppSupabaseClient,
    { page, pageSize, q, low }: InventoryQuery
): Promise<Page<InventoryListItem> & { summary: InventorySummary }> {
    let query = supabase
        .from('inventory')
        .select(SELECT)
        .is('product.deleted_at', null)
        // Untracked products and presentations have no stock of their own (a presentation's lives on its base).
        .eq('product.stock_mode', 'own')
        .order('quantity', { ascending: true })
        .limit(SUMMARY_LIMIT)
    const filter = searchFilter(q, ['name', 'sku'])
    if (filter) query = query.or(filter, { referencedTable: 'products' })

    const { data, error } = await query
    assertNoError(error)

    const presentations = await presentationsByBase(supabase)
    const items: InventoryListItem[] = data.map(({ product, ...row }) => {
        const { deleted_at: _deleted, stock_mode: _mode, ...visible } = product
        return {
            ...row,
            product: visible,
            variant: row.variant,
            presentations: row.variant_id === null ? (presentations.get(row.product_id) ?? []) : []
        }
    })
    const isLow = (item: InventoryListItem) => item.quantity <= item.low_stock_threshold
    const summary: InventorySummary = {
        total_units: items.reduce((sum, item) => sum + item.quantity, 0),
        item_count: items.length,
        low_stock_count: items.filter(isLow).length,
        // Cents, to avoid float drift when many rows are added.
        stock_value:
            items.reduce((sum, item) => sum + item.quantity * Math.round(item.product.cost_price * 100), 0) / 100
    }

    const matching = low ? items.filter(isLow) : items
    const { from, to } = pageRange({ page, pageSize })
    return { rows: matching.slice(from, to + 1), total: matching.length, summary }
}

/** Every live presentation, grouped by base (a few per store: cheaper than an `in` over up to 1000 row ids). */
async function presentationsByBase(
    supabase: AppSupabaseClient
): Promise<Map<string, InventoryListItem['presentations']>> {
    const byBase = new Map<string, InventoryListItem['presentations']>()
    const { data, error } = await supabase
        .from('products')
        .select('id, name, stock_units, stock_product_id')
        .eq('stock_mode', 'linked')
        .is('deleted_at', null)
        .order('stock_units', { ascending: false })
    assertNoError(error)
    for (const { stock_product_id: baseId, ...presentation } of data) {
        if (!baseId) continue
        byBase.set(baseId, [...(byBase.get(baseId) ?? []), presentation])
    }
    return byBase
}

export async function setThreshold(
    supabase: AppSupabaseClient,
    inventoryId: string,
    threshold: number
): Promise<{ low_stock_threshold: number }> {
    const { error } = await supabase.rpc('set_low_stock_threshold', {
        p_inventory_id: inventoryId,
        p_threshold: threshold
    })
    assertNoError(error)
    return { low_stock_threshold: threshold }
}

export async function adjustInventory(
    supabase: AppSupabaseClient,
    inventoryId: string,
    delta: number,
    reason: string
): Promise<{ quantity: number }> {
    const { data, error } = await supabase.rpc('adjust_inventory', {
        p_inventory_id: inventoryId,
        p_delta: delta,
        p_reason: reason
    })
    assertNoError(error)
    return { quantity: data }
}
