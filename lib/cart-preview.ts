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

/**
 * PREVIEW ONLY. Mirrors what `create_sale` computes (per-line tax rounded half up to the currency's smallest unit,
 * global discount after tax) so the till can show a total before charging. The server recomputes everything from the
 * database and its result is the one that counts. `decimals` is the currency's (2 for USD → cents, 0 for COP → whole
 * pesos); everything is integers in that unit and basis points, so 5 % of 10.50 does not drift by a float error.
 */
export function previewTotals(lines: PreviewLine[], globalDiscount = 0, decimals = 2): PreviewTotals {
    const unit = 10 ** decimals
    const toUnits = (amount: number) => Math.round(amount * unit)
    let subtotal = 0
    let tax = 0
    for (const line of lines) {
        const base = Math.max(toUnits(line.unitPrice) * line.quantity - toUnits(line.discount), 0)
        const rateBasisPoints = Math.round(line.taxRate * 10_000)
        subtotal += base
        tax += Math.floor((base * rateBasisPoints + 5_000) / 10_000)
    }
    const discount = toUnits(globalDiscount)
    const total = Math.max(subtotal + tax - discount, 0)
    return { subtotal: subtotal / unit, tax: tax / unit, discount: discount / unit, total: total / unit }
}
