import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** The cart holds only WHAT is being bought. Prices, taxes and stock are looked up live; the server computes the totals. */
export interface CartLine {
    productId: string
    quantity: number
    discount: number
}

interface CartStore {
    items: CartLine[]
    /** Order-level discount, applied after tax. */
    discount: number

    addItem: (productId: string, quantity?: number) => void
    removeItem: (productId: string) => void
    updateQuantity: (productId: string, quantity: number) => void
    updateItemDiscount: (productId: string, discount: number) => void
    setGlobalDiscount: (discount: number) => void
    clearCart: () => void
}

const MAX_QUANTITY = 100_000

export const useCartStore = create<CartStore>()(
    persist(
        set => ({
            items: [],
            discount: 0,

            addItem: (productId, quantity = 1) =>
                set(state => {
                    const existing = state.items.find(item => item.productId === productId)
                    if (existing) {
                        return {
                            items: state.items.map(item =>
                                item.productId === productId
                                    ? { ...item, quantity: Math.min(item.quantity + quantity, MAX_QUANTITY) }
                                    : item
                            )
                        }
                    }
                    return {
                        items: [...state.items, { productId, quantity: Math.min(quantity, MAX_QUANTITY), discount: 0 }]
                    }
                }),

            removeItem: productId =>
                set(state => ({ items: state.items.filter(item => item.productId !== productId) })),

            // A quantity of 0 (or less) removes the line.
            updateQuantity: (productId, quantity) =>
                set(state => ({
                    items:
                        quantity <= 0
                            ? state.items.filter(item => item.productId !== productId)
                            : state.items.map(item =>
                                  item.productId === productId
                                      ? { ...item, quantity: Math.min(quantity, MAX_QUANTITY) }
                                      : item
                              )
                })),

            updateItemDiscount: (productId, discount) =>
                set(state => ({
                    items: state.items.map(item =>
                        item.productId === productId ? { ...item, discount: Math.max(0, discount) } : item
                    )
                })),

            setGlobalDiscount: discount => set({ discount: Math.max(0, discount) }),

            clearCart: () => set({ items: [], discount: 0 })
        }),
        {
            name: 'pos-cart',
            // v1 persisted whole Product objects (stale prices): discard it instead of migrating it.
            version: 2,
            migrate: () => ({ items: [], discount: 0 }),
            partialize: state => ({ items: state.items, discount: state.discount })
        }
    )
)
