export interface PreviewLine {
    unitPrice: number
    /** Fraction (0.10 = 10 %). */
    taxRate: number
    quantity: number
    discount: number
}

export interface PreviewTotals {
    subtotal: number
    tax: number
    discount: number
    total: number
}

const toCents = (amount: number) => Math.round(amount * 100)

/**
 * PREVIEW ONLY. Mirrors what `create_sale` computes (per-line tax rounded half up to cents, global discount after tax) so
 * the till can show a total before charging. The server recomputes everything from the database and its result is the
 * one that counts. Works in integer cents / basis points so 5 % of 10.50 does not drift by a float error.
 */
export function previewTotals(lines: PreviewLine[], globalDiscount = 0): PreviewTotals {
    let subtotal = 0
    let tax = 0
    for (const line of lines) {
        const base = Math.max(toCents(line.unitPrice) * line.quantity - toCents(line.discount), 0)
        const rateBasisPoints = Math.round(line.taxRate * 10_000)
        subtotal += base
        tax += Math.floor((base * rateBasisPoints + 5_000) / 10_000)
    }
    const discount = toCents(globalDiscount)
    const total = Math.max(subtotal + tax - discount, 0)
    return { subtotal: subtotal / 100, tax: tax / 100, discount: discount / 100, total: total / 100 }
}
