import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

// zustand's persist middleware reads `window.localStorage`; give it an in-memory one before the store is created.
const memory = new Map<string, string>()
const localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key)
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage })
const { useCartStore } = await import('./cart')

const cart = () => useCartStore.getState()

// Bun runs every test file in one process and shares globals: do not leave a fake `window` behind.
afterAll(() => {
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'localStorage')
})

beforeEach(() => {
    memory.clear()
    cart().clearCart()
})

describe('cart store', () => {
    test('adds a product and merges repeated adds into one line', () => {
        cart().addItem('p1')
        cart().addItem('p1', 2)
        cart().addItem('p2')
        expect(cart().items).toEqual([
            { productId: 'p1', quantity: 3, discount: 0 },
            { productId: 'p2', quantity: 1, discount: 0 }
        ])
    })
    test('stores ids and quantities only: no prices, tax rates or product objects', () => {
        cart().addItem('p1')
        expect(Object.keys(cart().items[0] ?? {}).sort()).toEqual(['discount', 'productId', 'quantity'])
    })
    test('updates quantity; zero or less removes the line', () => {
        cart().addItem('p1')
        cart().updateQuantity('p1', 5)
        expect(cart().items[0]?.quantity).toBe(5)
        cart().updateQuantity('p1', 0)
        expect(cart().items).toEqual([])
    })
    test('removes a line without touching the others', () => {
        cart().addItem('p1')
        cart().addItem('p2')
        cart().removeItem('p1')
        expect(cart().items.map(item => item.productId)).toEqual(['p2'])
    })
    test('caps the quantity at the API limit', () => {
        cart().addItem('p1', 99_999)
        cart().addItem('p1', 99_999)
        expect(cart().items[0]?.quantity).toBe(100_000)
    })
    test('discounts cannot be negative', () => {
        cart().addItem('p1')
        cart().updateItemDiscount('p1', -3)
        cart().setGlobalDiscount(-1)
        expect(cart().items[0]?.discount).toBe(0)
        expect(cart().discount).toBe(0)
    })
    test('clearCart empties the lines and the order discount (used on logout)', () => {
        cart().addItem('p1')
        cart().setGlobalDiscount(5)
        cart().clearCart()
        expect(cart().items).toEqual([])
        expect(cart().discount).toBe(0)
    })
    test('persists only the data, not the actions', () => {
        cart().addItem('p1', 2)
        const saved = JSON.parse(memory.get('pos-cart') ?? '{}') as { state: Record<string, unknown>; version: number }
        expect(saved.version).toBe(2)
        expect(Object.keys(saved.state).sort()).toEqual(['discount', 'items'])
    })
})
