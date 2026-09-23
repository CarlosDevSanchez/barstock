import type { Tables } from '@/types/database'

/** The columns `taxBreakdown` needs from an order item. Kept narrow so callers can pass `OrderDetail['items']` as-is. */
export type ReceiptLine = Pick<Tables<'order_items'>, 'quantity' | 'unit_price' | 'discount' | 'tax' | 'tax_rate'>

export interface TaxBreakdownRow {
    /** Fraction (0.19 = 19 %); `null` for lines sold before the `tax_rate` snapshot existed. */
    rate: number | null
    /** Sum of each line's taxable base (`unit_price * quantity - discount`) at this rate. */
    base: number
    /** Sum of each line's already-computed tax (as stored by `create_sale`, never recomputed here). */
    tax: number
}

/**
 * Groups order items by their `tax_rate` snapshot, summing the taxable base and the tax already charged at each
 * rate (read from `order_items.tax`, not recomputed — this stays informational, never a money calculation).
 * Pure and DOM-free so it is unit-testable on its own; `ReceiptTicket` only renders the result.
 */
export function taxBreakdown(items: ReceiptLine[]): TaxBreakdownRow[] {
    const byRate = new Map<number | null, TaxBreakdownRow>()
    for (const item of items) {
        const base = item.unit_price * item.quantity - item.discount
        const row = byRate.get(item.tax_rate)
        if (row) {
            row.base += base
            row.tax += item.tax
        } else {
            byRate.set(item.tax_rate, { rate: item.tax_rate, base, tax: item.tax })
        }
    }
    // Highest rate first; unknown/legacy rate (null) last.
    return [...byRate.values()].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
}
