import { describe, expect, test } from 'bun:test'
import { previewTotals } from './cart-preview'

describe('previewTotals (2 decimals, USD)', () => {
    test('matches the database result for the seeded sale (2 x 29.99 at 10 % + 12.99 at 10 %)', () => {
        const totals = previewTotals([
            { unitPrice: 29.99, taxRate: 0.1, quantity: 2, discount: 0 },
            { unitPrice: 12.99, taxRate: 0.1, quantity: 1, discount: 0 }
        ])
        // Verified against create_sale on Supabase local: subtotal 72.97, tax 7.30, total 80.27.
        expect(totals).toEqual({ subtotal: 72.97, tax: 7.3, discount: 0, total: 80.27 })
    })
    test('taxes each line separately (per-line rounding, D3)', () => {
        const totals = previewTotals([
            { unitPrice: 0.05, taxRate: 0.1, quantity: 1, discount: 0 },
            { unitPrice: 0.05, taxRate: 0.1, quantity: 1, discount: 0 }
        ])
        expect(totals.tax).toBe(0.02) // 0.005 rounds half up to 0.01 on each line
    })
    test('rounds half up without float drift', () => {
        expect(previewTotals([{ unitPrice: 10.5, taxRate: 0.05, quantity: 1, discount: 0 }]).tax).toBe(0.53) // 0.525
        expect(previewTotals([{ unitPrice: 1.15, taxRate: 0.07, quantity: 1, discount: 0 }]).tax).toBe(0.08) // 0.0805
    })
    test('line discount reduces the taxable base; global discount applies after tax', () => {
        const totals = previewTotals([{ unitPrice: 20, taxRate: 0.1, quantity: 1, discount: 5 }], 2)
        expect(totals).toEqual({ subtotal: 15, tax: 1.5, discount: 2, total: 14.5 })
    })
    test('never goes negative', () => {
        expect(previewTotals([{ unitPrice: 1, taxRate: 0, quantity: 1, discount: 5 }]).total).toBe(0)
        expect(previewTotals([{ unitPrice: 1, taxRate: 0, quantity: 1, discount: 0 }], 50).total).toBe(0)
    })
    test('empty cart', () => {
        expect(previewTotals([])).toEqual({ subtotal: 0, tax: 0, discount: 0, total: 0 })
    })
})

describe('previewTotals (0 decimals, COP)', () => {
    test('whole pesos with 19 % IVA: 35 000 -> 6 650 tax -> 41 650', () => {
        const totals = previewTotals([{ unitPrice: 35000, taxRate: 0.19, quantity: 1, discount: 0 }], 0, 0)
        expect(totals).toEqual({ subtotal: 35000, tax: 6650, discount: 0, total: 41650 })
    })
    test('rounds the tax of each line half up to a whole peso', () => {
        // 1 999 * 0.19 = 379.81 -> 380; 2 x 1 999 = 3 998 * 0.19 = 759.62 -> 760
        expect(previewTotals([{ unitPrice: 1999, taxRate: 0.19, quantity: 1, discount: 0 }], 0, 0).tax).toBe(380)
        expect(previewTotals([{ unitPrice: 1999, taxRate: 0.19, quantity: 2, discount: 0 }], 0, 0).tax).toBe(760)
        // 10 x 0.19 = 1.9 -> 2; 5 x 0.10 = 0.5 -> 1 (half up)
        expect(previewTotals([{ unitPrice: 10, taxRate: 0.19, quantity: 1, discount: 0 }], 0, 0).tax).toBe(2)
        expect(previewTotals([{ unitPrice: 5, taxRate: 0.1, quantity: 1, discount: 0 }], 0, 0).tax).toBe(1)
    })
    test('taxes each line separately and applies the global discount after tax', () => {
        const totals = previewTotals(
            [
                { unitPrice: 25, taxRate: 0.1, quantity: 1, discount: 0 }, // 2.5 -> 3
                { unitPrice: 25, taxRate: 0.1, quantity: 1, discount: 0 } // 2.5 -> 3
            ],
            1000,
            0
        )
        expect(totals).toEqual({ subtotal: 50, tax: 6, discount: 1000, total: 0 })
        expect(previewTotals([{ unitPrice: 35000, taxRate: 0.19, quantity: 2, discount: 5000 }], 1650, 0)).toEqual({
            subtotal: 65000,
            tax: 12350,
            discount: 1650,
            total: 75700
        })
    })
    test('the default is still 2 decimals', () => {
        expect(previewTotals([{ unitPrice: 0.05, taxRate: 0.1, quantity: 1, discount: 0 }]).tax).toBe(0.01)
    })
})
