import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GET as snapshot } from '@/app/api/v1/pos/snapshot/route'
import type { PosSnapshot } from '@/lib/server/services/pos'
import {
    adminClient,
    createCustomer,
    createProduct,
    ensureTestUsers,
    pinStoreCurrency,
    uniq
} from '../helpers/integration'
import { dataOf, loginAs, TestClient } from '../helpers/http'

let cashier: TestClient
let manager: TestClient
let restoreCurrency: () => Promise<void>

beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
    ;[cashier, manager] = await Promise.all([loginAs('cashier'), loginAs('manager')])
})
afterAll(async () => {
    await restoreCurrency()
})

async function createPromo(opts: { name?: string; package_price: number; product_id: string }) {
    const { data: promo, error } = await adminClient()
        .from('promotions')
        .insert({ name: opts.name ?? uniq('Bucket'), package_price: opts.package_price, is_active: true })
        .select()
        .single()
    if (error) throw error
    const { error: itemsError } = await adminClient()
        .from('promotion_items')
        .insert({ promotion_id: promo.id, product_id: opts.product_id, quantity: 1 })
    if (itemsError) throw itemsError
    return promo
}

describe('GET /pos/snapshot', () => {
    test('needs a session', async () => {
        expect((await new TestClient().get(snapshot, 'pos/snapshot')).status).toBe(401)
    })

    test('cashiers can read it (same minimum role as the rest of the POS)', async () => {
        expect((await cashier.get(snapshot, 'pos/snapshot')).status).toBe(200)
        expect((await manager.get(snapshot, 'pos/snapshot')).status).toBe(200)
    })

    test('includes active products, promotions, categories and customers, in the same shape the live endpoints use', async () => {
        const tag = uniq('snap')
        const { data: category } = await adminClient()
            .from('categories')
            .insert({ name: `${tag}-category` })
            .select()
            .single()
        const active = await createProduct({ name: `${tag}-active`, category_id: category?.id, stock: 7 })
        const inactive = await createProduct({ name: `${tag}-inactive`, is_active: false, stock: 3 })
        await adminClient()
            .from('products')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', (await createProduct({ name: `${tag}-deleted`, stock: 1 })).id)
        const promo = await createPromo({ name: `${tag}-promo`, package_price: 5, product_id: active.id })
        const customer = await createCustomer({ name: `${tag}-customer` })
        const inactiveCustomer = await createCustomer({ name: `${tag}-inactive-customer`, is_active: false })

        const body = dataOf<PosSnapshot>(await cashier.get(snapshot, 'pos/snapshot'))

        expect(body.generated_at).toBeTruthy()
        const activeRow = body.products.find(p => p.id === active.id)
        expect(activeRow).toMatchObject({ name: `${tag}-active`, stock: 7, category: { id: category?.id } })
        expect(body.products.some(p => p.id === inactive.id)).toBe(false)
        expect(body.products.some(p => p.name === `${tag}-deleted`)).toBe(false)

        const promoRow = body.promotions.find(p => p.id === promo.id)
        expect(promoRow).toMatchObject({ name: `${tag}-promo`, package_price: 5 })
        expect(promoRow?.items[0]).toMatchObject({ product_id: active.id })

        expect(body.categories.some(c => c.id === category?.id)).toBe(true)
        expect(body.customers.some(c => c.id === customer.id)).toBe(true)
        expect(body.customers.some(c => c.id === inactiveCustomer.id)).toBe(false)
    })
})
