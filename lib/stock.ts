/**
 * Stock modes (supabase/migrations/20261009000001_stock_modes.sql), shared by the server and the POS:
 *
 * - `own`: the product counts its own units.
 * - `none`: never runs out (coffee, prepared drinks); it has no stock to show.
 * - `linked`: a presentation of a base product (a box of 15 cigarettes). Selling 1 takes `stock_units` from the base,
 *   so a box and loose singles compete for the same units.
 *
 * The database decides (create_sale / tab_add_items); these helpers only mirror it for the preview and the caps.
 */
export type StockMode = 'own' | 'none' | 'linked'

export interface StockInfo {
    id: string
    /** Missing on offline snapshots saved before stock modes existed: treated as `own`. */
    stock_mode?: StockMode
    stock_product_id?: string | null
    stock_units?: number
    /** Units on the shelf of the row this product sells from (the base for a presentation); null when untracked. */
    stock_base_quantity?: number | null
    /** Whole sellable units of this product (`floor(base / units)`); null when untracked or without a stock row. */
    stock: number | null
}

export const stockModeOf = (product: Pick<StockInfo, 'stock_mode'>): StockMode => product.stock_mode ?? 'own'

export const isUntracked = (product: Pick<StockInfo, 'stock_mode'>) => stockModeOf(product) === 'none'

/** The id of the stock row a product sells from: the base for a presentation, itself otherwise. */
export function stockKey(product: Pick<StockInfo, 'id' | 'stock_mode' | 'stock_product_id'>): string {
    return stockModeOf(product) === 'linked' && product.stock_product_id ? product.stock_product_id : product.id
}

/** Base units one unit of this product takes. */
export function unitsPer(product: Pick<StockInfo, 'stock_mode' | 'stock_units'>): number {
    return stockModeOf(product) === 'linked' ? Math.max(1, product.stock_units ?? 1) : 1
}

/** Whole units of a product that `baseQuantity` base units cover (null when there is nothing to count). */
export function effectiveStock(mode: StockMode, baseQuantity: number | null, units: number): number | null {
    if (mode === 'none' || baseQuantity === null) return null
    return Math.floor(baseQuantity / Math.max(1, units))
}

function baseQuantityOf(product: StockInfo): number | null {
    if (product.stock_base_quantity !== undefined) return product.stock_base_quantity
    // Older rows only carry `stock`; for a presentation that is already floor(base / units), a safe lower bound.
    return product.stock === null ? null : product.stock * unitsPer(product)
}

export interface StockLine {
    product: StockInfo
    quantity: number
}

/**
 * How many more units of `product` fit, given what is already in `lines` (the cart). Lines that sell from the same
 * base (a box and loose singles) share its units. `Infinity` for an untracked product, 0 without a stock row.
 */
export function maxAddable(product: StockInfo, lines: readonly StockLine[]): number {
    if (isUntracked(product)) return Number.POSITIVE_INFINITY
    const base = baseQuantityOf(product)
    if (base === null) return 0
    const key = stockKey(product)
    const used = lines
        .filter(line => !isUntracked(line.product) && stockKey(line.product) === key)
        .reduce((sum, line) => sum + line.quantity * unitsPer(line.product), 0)
    return Math.max(0, Math.floor((base - used) / unitsPer(product)))
}

/** False only when a tracked product has nothing left (or no stock row): untracked products are always sellable. */
export function isSellable(product: StockInfo): boolean {
    if (isUntracked(product)) return true
    return product.stock !== null && product.stock > 0
}
