import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GET as topProducts } from '@/app/api/v1/products/top/route'
import { POST as createSale } from '@/app/api/v1/sales/route'
import { POST as refund } from '@/app/api/v1/orders/[id]/refund/route'
import { adminClient, createProduct, ensureTestUsers, pinStoreCurrency, uniq } from '../helpers/integration'
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

interface Order {
    id: string
    items: Array<{ product_id: string; quantity: number }>
}
interface TopProductRow {
    product_id: string
    name: string
    selling_price: number
    stock: number | null
    category_name: string | null
    quantity: number
}

const sell = (client: TestClient, productId: string, quantity: number) =>
    client.post(createSale, 'sales', {
        body: { payment_method: 'cash', items: [{ product_id: productId, quantity }] }
    })

describe('GET /products/top', () => {
    test('needs a session', async () => {
        expect((await new TestClient().get(topProducts, 'products/top')).status).toBe(401)
    })

    test('rejects an out-of-range window or limit', async () => {
        expect((await cashier.get(topProducts, 'products/top?days=0')).status).toBe(422)
        expect((await cashier.get(topProducts, 'products/top?days=400')).status).toBe(422)
        expect((await cashier.get(topProducts, 'products/top?limit=0')).status).toBe(422)
        expect((await cashier.get(topProducts, 'products/top?limit=21')).status).toBe(422)
    })

    test('ranks by units sold, across every cashier, and a plain cashier sees the whole store’s mode', async () => {
        const tag = uniq('top')
        const best = await createProduct({ name: `${tag} best`, selling_price: 10, stock: 1000 })
        const worst = await createProduct({ name: `${tag} worst`, selling_price: 10, stock: 1000 })

        // Large quantities so this pair reliably lands in the top 20 regardless of what the rest of the suite (a
        // shared local database) has sold elsewhere. Split across two different cashiers: the ranking must not be
        // scoped to "my own sales" like orders_select is.
        await sell(cashier, best.id, 60)
        await sell(manager, best.id, 40) // 100 units total for "best"
        await sell(cashier, worst.id, 30)

        const response = await cashier.get(topProducts, `products/top?limit=20`)
        expect(response.status).toBe(200)
        const rows = dataOf<TopProductRow[]>(response)
        const byId = new Map(rows.map(row => [row.product_id, row]))
        expect(byId.get(best.id)).toMatchObject({ name: best.name, selling_price: 10, stock: 900, quantity: 100 })
        expect(byId.get(worst.id)).toMatchObject({ quantity: 30 })
        const bestIndex = rows.findIndex(row => row.product_id === best.id)
        const worstIndex = rows.findIndex(row => row.product_id === worst.id)
        expect(bestIndex).toBeLessThan(worstIndex)
    })

    test('excludes refunded orders and respects the day window', async () => {
        const tag = uniq('top-excl')
        const refunded = await createProduct({ name: `${tag} refunded`, selling_price: 10, stock: 100 })
        const stale = await createProduct({ name: `${tag} stale`, selling_price: 10, stock: 100 })
        // A large quantity so "fresh" reliably lands in the top 20 despite whatever noise the rest of the (shared)
        // suite has sold elsewhere.
        const fresh = await createProduct({ name: `${tag} fresh`, selling_price: 10, stock: 100 })

        const refundedOrder = dataOf<Order>(await sell(cashier, refunded.id, 3))
        await manager.post(refund, `orders/${refundedOrder.id}/refund`, {
            params: { id: refundedOrder.id },
            body: { reason: 'testing exclusion from the mode of sale' }
        })

        const staleOrder = dataOf<Order>(await sell(cashier, stale.id, 3))
        await adminClient()
            .from('orders')
            .update({ created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() })
            .eq('id', staleOrder.id)

        await sell(cashier, fresh.id, 50)

        const rows = dataOf<TopProductRow[]>(await cashier.get(topProducts, `products/top?limit=20`))
        const ids = rows.map(row => row.product_id)
        expect(ids).not.toContain(refunded.id)
        expect(ids).not.toContain(stale.id)
        expect(ids).toContain(fresh.id)
    })
})
