import { describe, expect, test } from 'bun:test'
import { groupOrderItemsByPromotion } from './order-item-groups'

const line = (
    overrides: Partial<{
        id: string
        promotion_id: string | null
        quantity: number
        total: number
        name: string
        promoName: string | null
    }>
) => ({
    id: overrides.id ?? 'i1',
    promotion_id: overrides.promotion_id ?? null,
    quantity: overrides.quantity ?? 1,
    unit_price: 1,
    discount: 0,
    tax: 0,
    total: overrides.total ?? 1,
    tax_rate: 0,
    product: { id: 'p', name: overrides.name ?? 'Beer', sku: 'B' },
    variant: null,
    promotion: overrides.promoName ? { id: overrides.promotion_id!, name: overrides.promoName } : null
})

describe('groupOrderItemsByPromotion', () => {
    test('keeps plain product lines', () => {
        const groups = groupOrderItemsByPromotion([line({ id: 'a' }), line({ id: 'b', name: 'Snack' })])
        expect(groups).toHaveLength(2)
        expect(groups.every(g => g.kind === 'product')).toBe(true)
    })

    test('groups components that share a promotion_id', () => {
        const promoId = 'promo-1'
        const groups = groupOrderItemsByPromotion([
            line({ id: 'a', promotion_id: promoId, quantity: 6, total: 12, promoName: 'Bucket' }),
            line({ id: 'b', promotion_id: promoId, quantity: 1, total: 3, name: 'Snack', promoName: 'Bucket' }),
            line({ id: 'c', name: 'Solo' })
        ])
        expect(groups).toHaveLength(2)
        expect(groups[0]).toMatchObject({
            kind: 'promotion',
            name: 'Bucket',
            total: 15,
            packageQty: 1
        })
        expect(groups[1]).toMatchObject({ kind: 'product' })
    })

    test('infers package count from GCD of component quantities', () => {
        const promoId = 'promo-2'
        const groups = groupOrderItemsByPromotion([
            line({ id: 'a', promotion_id: promoId, quantity: 12, promoName: 'Bucket' }),
            line({ id: 'b', promotion_id: promoId, quantity: 2, promoName: 'Bucket' })
        ])
        expect(groups[0]).toMatchObject({ kind: 'promotion', packageQty: 2 })
    })

    test('uses promotion recipe so 8 beers of recipe 4 = 2 packages (not GCD 8)', () => {
        const promoId = 'promo-3'
        const recipe = [{ product_id: 'p', quantity: 4 }]
        const groups = groupOrderItemsByPromotion([
            {
                ...line({ id: 'a', promotion_id: promoId, quantity: 8, promoName: 'Bucket' }),
                promotion: { id: promoId, name: 'Bucket', items: recipe }
            }
        ])
        expect(groups[0]).toMatchObject({ kind: 'promotion', packageQty: 2 })
    })
})
