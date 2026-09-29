import { describe, expect, test } from 'bun:test'
import { effectiveStock, isSellable, maxAddable, stockKey, unitsPer, type StockInfo } from './stock'

const single: StockInfo = { id: 'single', stock_mode: 'own', stock_units: 1, stock_base_quantity: 37, stock: 37 }
const box: StockInfo = {
    id: 'box',
    stock_mode: 'linked',
    stock_product_id: 'single',
    stock_units: 15,
    stock_base_quantity: 37,
    stock: 2
}
const coffee: StockInfo = { id: 'coffee', stock_mode: 'none', stock_units: 1, stock_base_quantity: null, stock: null }

describe('stock modes', () => {
    test('a presentation sells from its base, n units at a time', () => {
        expect(stockKey(box)).toBe('single')
        expect(stockKey(single)).toBe('single')
        expect(unitsPer(box)).toBe(15)
        expect(unitsPer(single)).toBe(1)
    })

    test('effective stock is whole presentations; untracked has none', () => {
        expect(effectiveStock('linked', 37, 15)).toBe(2)
        expect(effectiveStock('own', 37, 1)).toBe(37)
        expect(effectiveStock('none', 37, 1)).toBeNull()
        expect(effectiveStock('own', null, 1)).toBeNull()
    })

    test('a box and loose singles in the cart share the same units', () => {
        expect(maxAddable(box, [])).toBe(2)
        expect(maxAddable(single, [{ product: box, quantity: 2 }])).toBe(7)
        expect(maxAddable(box, [{ product: single, quantity: 8 }])).toBe(1)
        expect(maxAddable(box, [{ product: single, quantity: 23 }])).toBe(0)
        // Unrelated or untracked lines do not count against the base.
        expect(maxAddable(single, [{ product: coffee, quantity: 50 }])).toBe(37)
    })

    test('an untracked product never runs out; a tracked one without a row cannot be sold', () => {
        expect(maxAddable(coffee, [{ product: coffee, quantity: 999 }])).toBe(Number.POSITIVE_INFINITY)
        expect(isSellable(coffee)).toBe(true)
        expect(isSellable({ id: 'x', stock: null })).toBe(false)
        expect(maxAddable({ id: 'x', stock: null }, [])).toBe(0)
    })

    test('a snapshot saved before stock modes existed behaves as own stock', () => {
        const legacy: StockInfo = { id: 'legacy', stock: 4 }
        expect(stockKey(legacy)).toBe('legacy')
        expect(maxAddable(legacy, [{ product: legacy, quantity: 1 }])).toBe(3)
        expect(isSellable({ id: 'legacy', stock: 0 })).toBe(false)
    })
})
