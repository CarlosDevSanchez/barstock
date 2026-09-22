import { describe, expect, test } from 'bun:test'
import { taxBreakdown, type ReceiptLine } from './receipt'

const line = (overrides: Partial<ReceiptLine>): ReceiptLine => ({
    quantity: 1,
    unit_price: 100,
    discount: 0,
    tax: 19,
    tax_rate: 0.19,
    ...overrides
})

describe('taxBreakdown', () => {
    test('a single rate: one row with the summed base and tax', () => {
        expect(
            taxBreakdown([
                line({ unit_price: 100, quantity: 1, tax: 19, tax_rate: 0.19 }),
                line({ unit_price: 50, quantity: 2, tax: 19, tax_rate: 0.19 })
            ])
        ).toEqual([{ rate: 0.19, base: 200, tax: 38 }])
    })

    test('several rates: one row per rate, highest first', () => {
        const rows = taxBreakdown([
            line({ unit_price: 100, quantity: 1, tax: 19, tax_rate: 0.19 }),
            line({ unit_price: 20, quantity: 1, tax: 1, tax_rate: 0.05 }),
            line({ unit_price: 30, quantity: 1, tax: 0, tax_rate: 0 })
        ])
        expect(rows).toEqual([
            { rate: 0.19, base: 100, tax: 19 },
            { rate: 0.05, base: 20, tax: 1 },
            { rate: 0, base: 30, tax: 0 }
        ])
    })

    test('the taxable base subtracts the line discount', () => {
        expect(taxBreakdown([line({ unit_price: 100, quantity: 2, discount: 30, tax: 32.3, tax_rate: 0.19 })])).toEqual(
            [{ rate: 0.19, base: 170, tax: 32.3 }]
        )
    })

    test('a legacy line with no tax_rate snapshot groups under null, sorted last', () => {
        const rows = taxBreakdown([
            line({ unit_price: 100, quantity: 1, tax: 19, tax_rate: 0.19 }),
            line({ unit_price: 50, quantity: 1, tax: 5, tax_rate: null })
        ])
        expect(rows).toEqual([
            { rate: 0.19, base: 100, tax: 19 },
            { rate: null, base: 50, tax: 5 }
        ])
    })

    test('two lines with no rate merge into the same null row', () => {
        expect(
            taxBreakdown([
                line({ unit_price: 10, quantity: 1, tax: 1, tax_rate: null }),
                line({ unit_price: 20, quantity: 1, tax: 2, tax_rate: null })
            ])
        ).toEqual([{ rate: null, base: 30, tax: 3 }])
    })

    test('empty cart', () => {
        expect(taxBreakdown([])).toEqual([])
    })
})
