import { describe, expect, test } from 'bun:test'
import { productMargins } from './margin'

// Rows taken from the business's spreadsheet (EJEMPLO PORCENTAJE PRODUCTO.xlsx), target markup 35 %.
describe('productMargins', () => {
    test('Póker: cost 2 217, price 5 000 (COP rounds to whole pesos)', () => {
        const margins = productMargins(2217, 5000, 0.35, 'COP')
        expect(margins.markupAmount).toBe(776)
        expect(margins.suggestedPrice).toBe(2993)
        expect(margins.profit).toBe(2783)
        expect(margins.realMargin).toBeCloseTo(0.5566, 4)
    })

    test('Club Colombia: cost 2 984, price 5 500', () => {
        const margins = productMargins(2984, 5500, 0.35, 'COP')
        expect(margins.suggestedPrice).toBe(4028)
        expect(margins.profit).toBe(2516)
        expect(margins.realMargin).toBeCloseTo(0.4575, 4)
    })

    test('keeps the currency decimals (USD)', () => {
        const margins = productMargins(2217, 5000, 0.35, 'USD')
        expect(margins.markupAmount).toBe(775.95)
        expect(margins.suggestedPrice).toBe(2992.95)
    })

    test('fractional unit cost (Liefmans: 83 542 / 6)', () => {
        const margins = productMargins(83542 / 6, 21500, 0.35, 'COP')
        expect(margins.suggestedPrice).toBe(18797)
        expect(margins.realMargin).toBeCloseTo(0.3524, 4)
    })

    test('no price: no real margin, negative profit', () => {
        const margins = productMargins(1000, 0, 0.35, 'COP')
        expect(margins.realMargin).toBeNull()
        expect(margins.profit).toBe(-1000)
    })

    test('selling below cost gives a negative margin', () => {
        const margins = productMargins(6000, 5000, 0.35, 'COP')
        expect(margins.profit).toBe(-1000)
        expect(margins.realMargin).toBeCloseTo(-0.2, 4)
    })

    test('zero cost: everything is profit', () => {
        const margins = productMargins(0, 5000, 0.35, 'COP')
        expect(margins.suggestedPrice).toBe(0)
        expect(margins.realMargin).toBe(1)
    })
})
