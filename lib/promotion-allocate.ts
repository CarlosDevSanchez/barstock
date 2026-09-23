/**
 * Splits a fixed package price across component products so the till preview matches `create_sale`.
 * Works in minor currency units; the last component absorbs leftover cents so Σ bases = package_price × packages.
 * When base/qty is not exact at `decimals`, unit_price is ceiled and a line discount absorbs the excess
 * (same rule as the RPC — keep both in sync).
 */

export interface AllocationComponent {
    productId: string
    /** Units of this product per one package. */
    quantity: number
    sellingPrice: number
    /** Fraction (0.10 = 10 %). */
    taxRate: number
}

export interface AllocatedLine {
    productId: string
    quantity: number
    unitPrice: number
    discount: number
    taxRate: number
}

export function allocatePackagePrice(
    packagePrice: number,
    packages: number,
    components: AllocationComponent[],
    decimals = 2
): AllocatedLine[] {
    if (components.length === 0 || packages <= 0) return []

    const unit = 10 ** decimals
    const totalUnits = Math.round(packagePrice * unit) * packages
    const weights = components.map(c => Math.max(0, Math.round(c.sellingPrice * unit) * c.quantity))
    const totalWeight = weights.reduce((sum, w) => sum + w, 0)

    const baseUnits: number[] = []
    let used = 0
    for (let i = 0; i < components.length; i++) {
        if (i === components.length - 1) {
            baseUnits.push(totalUnits - used)
        } else {
            const share =
                totalWeight === 0
                    ? Math.floor(totalUnits / components.length)
                    : Math.floor((totalUnits * (weights[i] ?? 0)) / totalWeight)
            baseUnits.push(share)
            used += share
        }
    }

    return components.map((c, i) => {
        const qty = c.quantity * packages
        const base = baseUnits[i] ?? 0
        // Integer ceil so unit_price*qty >= base; discount pulls the line back to `base`.
        const unitPriceUnits = qty <= 0 ? 0 : Math.floor((base + qty - 1) / qty)
        const discountUnits = unitPriceUnits * qty - base
        return {
            productId: c.productId,
            quantity: qty,
            unitPrice: unitPriceUnits / unit,
            discount: discountUnits / unit,
            taxRate: c.taxRate
        }
    })
}

/** Packages sellable from component stock: floor(min(stock_i / qty_i)); null if any component lacks inventory. */
export function packagesAvailable(components: Array<{ quantity: number; stock: number | null }>): number | null {
    if (components.length === 0) return 0
    let min = Number.POSITIVE_INFINITY
    for (const c of components) {
        if (c.stock === null || c.quantity <= 0) return null
        min = Math.min(min, Math.floor(c.stock / c.quantity))
    }
    return Number.isFinite(min) ? min : 0
}

/**
 * Product ids that currently limit `packagesAvailable` (tightest floor(stock/qty)).
 * Empty when unavailable (null stock) or there are no components.
 */
export function packageBottleneckProductIds(
    components: Array<{ productId: string; quantity: number; stock: number | null }>
): string[] {
    const available = packagesAvailable(components)
    if (available === null || components.length === 0) return []
    return components
        .filter(c => c.stock !== null && c.quantity > 0 && Math.floor(c.stock / c.quantity) === available)
        .map(c => c.productId)
}
