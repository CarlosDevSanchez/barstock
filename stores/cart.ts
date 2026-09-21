import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, Product, ProductVariant } from '@/types'

interface CartStore {
    items: CartItem[]
    discount: number
    taxRate: number

    // Actions
    addItem: (product: Product, variant?: ProductVariant, quantity?: number) => void
    removeItem: (productId: string, variantId?: string) => void
    updateQuantity: (productId: string, variantId: string | undefined, quantity: number) => void
    updateItemDiscount: (productId: string, variantId: string | undefined, discount: number) => void
    setGlobalDiscount: (discount: number) => void
    setTaxRate: (rate: number) => void
    clearCart: () => void

    // Computed
    getSubtotal: () => number
    getTax: () => number
    getTotal: () => number
}

export const useCartStore = create<CartStore>()(
    persist(
        (set, get) => ({
            items: [],
            discount: 0,
            taxRate: 0.1,

            addItem: (product, variant, quantity = 1) => {
                const state = get()
                const existingIndex = state.items.findIndex(
                    item => item.product.id === product.id && item.variant?.id === variant?.id
                )

                if (existingIndex >= 0) {
                    const newItems = state.items.map((item, index) =>
                        index === existingIndex ? { ...item, quantity: item.quantity + quantity } : item
                    )
                    set({ items: newItems })
                } else {
                    set({
                        items: [...state.items, { product, variant, quantity, discount: 0 }]
                    })
                }
            },

            removeItem: (productId, variantId) => {
                set(state => ({
                    items: state.items.filter(
                        item => !(item.product.id === productId && item.variant?.id === variantId)
                    )
                }))
            },

            updateQuantity: (productId, variantId, quantity) => {
                set(state => ({
                    items: state.items.map(item =>
                        item.product.id === productId && item.variant?.id === variantId
                            ? { ...item, quantity: Math.max(0, quantity) }
                            : item
                    )
                }))
            },

            updateItemDiscount: (productId, variantId, discount) => {
                set(state => ({
                    items: state.items.map(item =>
                        item.product.id === productId && item.variant?.id === variantId ? { ...item, discount } : item
                    )
                }))
            },

            setGlobalDiscount: discount => set({ discount }),

            setTaxRate: rate => set({ taxRate: rate }),

            clearCart: () => set({ items: [], discount: 0 }),

            getSubtotal: () => {
                const state = get()
                return state.items.reduce((sum, item) => {
                    const price = item.variant?.selling_price ?? item.product.selling_price
                    return sum + (price * item.quantity - item.discount)
                }, 0)
            },

            getTax: () => {
                const state = get()
                const subtotal = state.getSubtotal()
                const afterDiscount = subtotal - state.discount
                return afterDiscount * state.taxRate
            },

            getTotal: () => {
                const state = get()
                const subtotal = state.getSubtotal()
                const tax = state.getTax()
                return subtotal - state.discount + tax
            }
        }),
        {
            name: 'pos-cart'
        }
    )
)
