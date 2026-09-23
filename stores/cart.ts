import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The cart holds only WHAT is being bought. Prices, taxes and stock are looked up live; the server computes the totals.
 * Discriminated lines: a product (optional line discount) or a fixed-price promotion package (no client price).
 */
export type CartLine =
    | { kind: 'product'; productId: string; quantity: number; discount: number }
    | { kind: 'promotion'; promotionId: string; quantity: number }

export function cartLineKey(line: CartLine): string {
    return line.kind === 'product' ? `p:${line.productId}` : `promo:${line.promotionId}`
}

interface CartStore {
    items: CartLine[]
    /** Order-level discount, applied after tax. */
    discount: number

    addItem: (productId: string, quantity?: number) => void
    addPromotion: (promotionId: string, quantity?: number) => void
    removeItem: (key: string) => void
    updateQuantity: (key: string, quantity: number) => void
    updateItemDiscount: (productId: string, discount: number) => void
    setGlobalDiscount: (discount: number) => void
    clearCart: () => void
    hasPromotions: () => boolean
}

const MAX_QUANTITY = 100_000

function mergeQuantity(current: number, add: number): number {
    return Math.min(current + add, MAX_QUANTITY)
}

export const useCartStore = create<CartStore>()(
    persist(
        (set, get) => ({
            items: [],
            discount: 0,

            addItem: (productId, quantity = 1) =>
                set(state => {
                    const existing = state.items.find(item => item.kind === 'product' && item.productId === productId)
                    if (existing && existing.kind === 'product') {
                        return {
                            items: state.items.map(item =>
                                item.kind === 'product' && item.productId === productId
                                    ? { ...item, quantity: mergeQuantity(item.quantity, quantity) }
                                    : item
                            )
                        }
                    }
                    return {
                        items: [
                            ...state.items,
                            { kind: 'product', productId, quantity: Math.min(quantity, MAX_QUANTITY), discount: 0 }
                        ]
                    }
                }),

            addPromotion: (promotionId, quantity = 1) =>
                set(state => {
                    const existing = state.items.find(
                        item => item.kind === 'promotion' && item.promotionId === promotionId
                    )
                    if (existing && existing.kind === 'promotion') {
                        return {
                            items: state.items.map(item =>
                                item.kind === 'promotion' && item.promotionId === promotionId
                                    ? { ...item, quantity: mergeQuantity(item.quantity, quantity) }
                                    : item
                            )
                        }
                    }
                    return {
                        items: [
                            ...state.items,
                            { kind: 'promotion', promotionId, quantity: Math.min(quantity, MAX_QUANTITY) }
                        ]
                    }
                }),

            removeItem: key => set(state => ({ items: state.items.filter(item => cartLineKey(item) !== key) })),

            // A quantity of 0 (or less) removes the line.
            updateQuantity: (key, quantity) =>
                set(state => ({
                    items:
                        quantity <= 0
                            ? state.items.filter(item => cartLineKey(item) !== key)
                            : state.items.map(item =>
                                  cartLineKey(item) === key
                                      ? { ...item, quantity: Math.min(quantity, MAX_QUANTITY) }
                                      : item
                              )
                })),

            updateItemDiscount: (productId, discount) =>
                set(state => ({
                    items: state.items.map(item =>
                        item.kind === 'product' && item.productId === productId
                            ? { ...item, discount: Math.max(0, discount) }
                            : item
                    )
                })),

            setGlobalDiscount: discount => set({ discount: Math.max(0, discount) }),

            clearCart: () => set({ items: [], discount: 0 }),

            hasPromotions: () => get().items.some(item => item.kind === 'promotion')
        }),
        {
            name: 'pos-cart',
            // v1: whole Product objects; v2: product-only lines; v3: discriminated product|promotion — discard prior.
            version: 3,
            migrate: () => ({ items: [], discount: 0 }),
            partialize: state => ({ items: state.items, discount: state.discount })
        }
    )
)
