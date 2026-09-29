import { roundMoney } from '@/lib/money'

export interface ProductMargins {
    /** cost × target markup: what the target adds on top of the cost. */
    markupAmount: number
    /** cost + markupAmount: the price that reaches the target markup. */
    suggestedPrice: number
    /** price − cost, per unit (negative when selling below cost). */
    profit: number
    /** (price − cost) / price as a fraction; null when there is no price to divide by. */
    realMargin: number | null
}

/**
 * INFORMATIVE ONLY (never written to the database). Mirrors the business's pricing spreadsheet: a target markup on
 * the cost ("%MARGEN", 35 % by default) gives a suggested price, and the real margin is measured on the selling price
 * ("% REAL"). Prices are before tax, like `products.selling_price`.
 */
export function productMargins(cost: number, price: number, targetMarkup: number, currency: string): ProductMargins {
    const markupAmount = roundMoney(cost * targetMarkup, currency)
    return {
        markupAmount,
        suggestedPrice: roundMoney(cost + cost * targetMarkup, currency),
        profit: roundMoney(price - cost, currency),
        realMargin: price > 0 ? (price - cost) / price : null
    }
}
