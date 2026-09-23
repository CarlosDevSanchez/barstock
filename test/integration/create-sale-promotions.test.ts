import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
    adminClient,
    createProduct,
    ensureTestUsers,
    pinStoreCurrency,
    signedInClient,
    stockOf,
    uniq,
    type Db
} from '../helpers/integration'

let cashier: Db
const service = () => adminClient()
const walkIn = null as unknown as string

let restoreCurrency: () => Promise<void>

beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
    cashier = await signedInClient('cashier')
})
afterAll(async () => {
    await restoreCurrency()
})

async function createPromo(opts: {
    name?: string
    package_price: number
    items: Array<{ product_id: string; quantity: number }>
}) {
    const { data: promo, error } = await service()
        .from('promotions')
        .insert({
            name: opts.name ?? uniq('Bucket'),
            package_price: opts.package_price,
            is_active: true
        })
        .select()
        .single()
    if (error) throw error
    const { error: itemsError } = await service()
        .from('promotion_items')
        .insert(opts.items.map(item => ({ promotion_id: promo.id, ...item })))
    if (itemsError) throw itemsError
    return promo
}

describe('create_sale with promotions', () => {
    test('expands a package, assigns unit prices (not catalog), and decrements each component', async () => {
        const beer = await createProduct({ selling_price: 3, tax_rate: 0.1, stock: 20 })
        const snack = await createProduct({ selling_price: 5, tax_rate: 0, stock: 5 })
        const promo = await createPromo({
            package_price: 20,
            items: [
                { product_id: beer.id, quantity: 6 },
                { product_id: snack.id, quantity: 1 }
            ]
        })

        const { data: orderId, error } = await cashier.rpc('create_sale', {
            p_customer_id: walkIn,
            p_items: [{ promotion_id: promo.id, quantity: 2 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        expect(error).toBeNull()
        expect(await stockOf(beer.id)).toBe(8) // 20 - 12
        expect(await stockOf(snack.id)).toBe(3) // 5 - 2

        const { data: lines } = await service()
            .from('order_items')
            .select('product_id, quantity, unit_price, discount, promotion_id, tax, total')
            .eq('order_id', orderId!)
            .order('product_id')
        expect(lines).toHaveLength(2)
        expect(lines?.every(l => l.promotion_id === promo.id)).toBe(true)
        // Assigned price ≠ catalog: beer catalog is 3, but package is cheaper.
        const beerLine = lines?.find(l => l.product_id === beer.id)
        expect(beerLine?.quantity).toBe(12)
        expect(beerLine?.unit_price).not.toBe(3)
        const bases = (lines ?? []).reduce((s, l) => s + Number(l.unit_price) * l.quantity - Number(l.discount), 0)
        expect(bases).toBeCloseTo(40, 6) // package_price × 2

        const { data: order } = await service().from('orders').select('subtotal, total').eq('id', orderId!).single()
        expect(Number(order?.subtotal)).toBeCloseTo(40, 6)
    })

    test('1 package with 2 distinct products (qty 1 each) deducts exactly 1 of each — not 2 packages', async () => {
        const a = await createProduct({ selling_price: 4, tax_rate: 0, stock: 5 })
        const b = await createProduct({ selling_price: 6, tax_rate: 0, stock: 5 })
        const promo = await createPromo({
            package_price: 8,
            items: [
                { product_id: a.id, quantity: 1 },
                { product_id: b.id, quantity: 1 }
            ]
        })

        const { data: orderId, error } = await cashier.rpc('create_sale', {
            p_customer_id: walkIn,
            p_items: [{ promotion_id: promo.id, quantity: 1 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        expect(error).toBeNull()
        expect(await stockOf(a.id)).toBe(4)
        expect(await stockOf(b.id)).toBe(4)

        const { data: lines } = await service()
            .from('order_items')
            .select('product_id, quantity, promotion_id')
            .eq('order_id', orderId!)
        expect(lines).toHaveLength(2)
        expect(lines?.every(l => l.quantity === 1 && l.promotion_id === promo.id)).toBe(true)
    })

    test('ignores a client-supplied unit_price on a promotion entry', async () => {
        const a = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const b = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const promo = await createPromo({
            package_price: 15,
            items: [
                { product_id: a.id, quantity: 1 },
                { product_id: b.id, quantity: 1 }
            ]
        })
        const { data: orderId, error } = await cashier.rpc('create_sale', {
            p_customer_id: walkIn,
            p_items: [{ promotion_id: promo.id, quantity: 1, unit_price: 0.01 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        expect(error).toBeNull()
        const { data: lines } = await service()
            .from('order_items')
            .select('unit_price, discount')
            .eq('order_id', orderId!)
        const base = (lines ?? []).reduce((s, l) => s + Number(l.unit_price) - Number(l.discount), 0)
        expect(base).toBeCloseTo(15, 6)
        expect(lines?.some(l => Number(l.unit_price) === 0.01)).toBe(false)
    })

    test('fails atomically when one component lacks stock', async () => {
        const a = await createProduct({ selling_price: 10, tax_rate: 0, stock: 10 })
        const b = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const promo = await createPromo({
            package_price: 18,
            items: [
                { product_id: a.id, quantity: 2 },
                { product_id: b.id, quantity: 2 }
            ]
        })
        const { error } = await cashier.rpc('create_sale', {
            p_customer_id: walkIn,
            p_items: [{ promotion_id: promo.id, quantity: 1 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        expect(error?.message).toMatch(/^Insufficient stock/)
        expect(await stockOf(a.id)).toBe(10)
        expect(await stockOf(b.id)).toBe(1)
    })

    test('rejects an inactive or soft-deleted promotion', async () => {
        const product = await createProduct({ stock: 5 })
        const promo = await createPromo({
            package_price: 9,
            items: [{ product_id: product.id, quantity: 1 }]
        })
        await service().from('promotions').update({ is_active: false }).eq('id', promo.id)
        expect(
            (
                await cashier.rpc('create_sale', {
                    p_customer_id: walkIn,
                    p_items: [{ promotion_id: promo.id, quantity: 1 }],
                    p_payment_method: 'cash',
                    p_discount: 0
                })
            ).error?.message
        ).toBe('Promotion not available')

        await service()
            .from('promotions')
            .update({ is_active: true, deleted_at: new Date().toISOString() })
            .eq('id', promo.id)
        expect(
            (
                await cashier.rpc('create_sale', {
                    p_customer_id: walkIn,
                    p_items: [{ promotion_id: promo.id, quantity: 1 }],
                    p_payment_method: 'cash',
                    p_discount: 0
                })
            ).error?.message
        ).toBe('Promotion not available')
        expect(await stockOf(product.id)).toBe(5)
    })
})
