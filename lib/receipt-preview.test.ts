import { describe, expect, test } from 'bun:test'
import type { CartLineView } from '@/components/pos/cart-sheet'
import type { ProductListItem } from '@/lib/api/products'
import type { PromotionListItem } from '@/lib/api/promotions'
import { buildProvisionalOrder } from './receipt-preview'
import { previewTotals } from './cart-preview'

const mouse: ProductListItem = {
    id: 'p-mouse',
    name: 'Wireless Mouse',
    sku: 'ELEC-001',
    selling_price: 29.99,
    tax_rate: 0.1,
    stock: 5,
    category_id: null,
    category: null,
    is_active: true,
    deleted_at: null,
    barcode: null,
    description: null,
    cost_price: 15,
    image_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
}

function productLine(quantity: number, discount = 0): CartLineView {
    return { kind: 'product', item: { kind: 'product', productId: mouse.id, quantity, discount }, product: mouse }
}

const promo: PromotionListItem = {
    id: 'promo-1',
    name: 'Combo Bar',
    package_price: 20,
    is_active: true,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    available: 5,
    items: [
        {
            id: 'pi-1',
            product_id: 'p-beer',
            quantity: 2,
            product: {
                id: 'p-beer',
                name: 'Beer',
                is_active: true,
                deleted_at: null,
                selling_price: 8,
                tax_rate: 0.1,
                stock: 10
            }
        },
        {
            id: 'pi-2',
            product_id: 'p-chips',
            quantity: 1,
            product: {
                id: 'p-chips',
                name: 'Chips',
                is_active: true,
                deleted_at: null,
                selling_price: 5,
                tax_rate: 0.1,
                stock: 10
            }
        }
    ]
}

function promoLine(quantity: number): CartLineView {
    return { kind: 'promotion', item: { kind: 'promotion', promotionId: promo.id, quantity }, promotion: promo }
}

const baseInput = {
    provisionalNumber: 'OFF-ABCD1234',
    occurredAt: '2026-09-24T10:00:00Z',
    customerName: null as string | null,
    paymentMethod: 'cash' as const,
    cashierName: 'Jane Cashier',
    decimals: 2
}

describe('buildProvisionalOrder', () => {
    test('a plain product line matches the same math previewTotals already shows the cashier', () => {
        const lines = [productLine(2)]
        const totals = previewTotals(
            [{ unitPrice: mouse.selling_price, taxRate: mouse.tax_rate, quantity: 2, discount: 0 }],
            0,
            2
        )
        const order = buildProvisionalOrder({ ...baseInput, lines, totals })

        expect(order.order_number).toBe('OFF-ABCD1234')
        expect(order.source).toBe('offline')
        expect(order.occurred_at).toBe('2026-09-24T10:00:00Z')
        expect(order.total).toBe(totals.total)
        expect(order.items).toHaveLength(1)
        expect(order.items[0]).toMatchObject({
            product_id: mouse.id,
            quantity: 2,
            unit_price: 29.99,
            product: { name: 'Wireless Mouse' }
        })
        // unit_price * qty - discount + tax, rounded the same way previewTotals rounds a line
        expect(order.items[0]!.total).toBeCloseTo(2 * 29.99 * 1.1, 2)
    })

    test('a promotion line expands into one item per component, summing back to the package price', () => {
        const lines = [promoLine(1)]
        const totals = previewTotals([], 0, 2) // package math is per-component below, not through previewTotals here
        const order = buildProvisionalOrder({ ...baseInput, lines, totals })

        expect(order.items).toHaveLength(2)
        expect(order.items.map(item => item.product.name).sort()).toEqual(['Beer', 'Chips'])
        for (const item of order.items) expect(item.promotion).toMatchObject({ id: promo.id, name: 'Combo Bar' })
        // Base (unit_price*qty - discount) across both components sums to the package price (before tax).
        const base = order.items.reduce((sum, item) => sum + item.unit_price * item.quantity - item.discount, 0)
        expect(base).toBeCloseTo(20, 2)
    })

    test('skips a cart line whose product/promotion never resolved (offline lookup miss)', () => {
        const lines: CartLineView[] = [
            {
                kind: 'product',
                item: { kind: 'product', productId: 'missing', quantity: 1, discount: 0 },
                product: undefined
            },
            productLine(1)
        ]
        const order = buildProvisionalOrder({ ...baseInput, lines, totals: previewTotals([], 0, 2) })
        expect(order.items).toHaveLength(1)
        expect(order.items[0]!.product_id).toBe(mouse.id)
    })

    test('carries the customer name and cashier name through, and null customer when walk-in', () => {
        const withCustomer = buildProvisionalOrder({
            ...baseInput,
            customerName: 'Maria Lopez',
            lines: [productLine(1)],
            totals: previewTotals([], 0, 2)
        })
        expect(withCustomer.customer).toMatchObject({ name: 'Maria Lopez' })
        expect(withCustomer.created_by_name).toBe('Jane Cashier')

        const walkIn = buildProvisionalOrder({ ...baseInput, lines: [productLine(1)], totals: previewTotals([], 0, 2) })
        expect(walkIn.customer).toBeNull()
    })

    test('records exactly one payment for the full total, in the given method', () => {
        const totals = previewTotals([{ unitPrice: 10, taxRate: 0, quantity: 1, discount: 0 }], 0, 2)
        const order = buildProvisionalOrder({
            ...baseInput,
            paymentMethod: 'card',
            lines: [productLine(1)],
            totals
        })
        expect(order.payments).toHaveLength(1)
        expect(order.payments[0]).toMatchObject({ payment_method: 'card', amount: totals.total })
    })
})
