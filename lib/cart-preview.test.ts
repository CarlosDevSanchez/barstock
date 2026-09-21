import { describe, expect, test } from 'bun:test'
import { previewTotals } from './cart-preview'

describe('previewTotals', () => {
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
