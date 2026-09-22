import { beforeAll, describe, expect, test } from 'bun:test'
import { POST as adjust } from '@/app/api/v1/inventory/[id]/adjust/route'
import { GET as listInventory } from '@/app/api/v1/inventory/route'
import { GET as getOrder } from '@/app/api/v1/orders/[id]/route'
import { POST as refund } from '@/app/api/v1/orders/[id]/refund/route'
import { GET as listOrders } from '@/app/api/v1/orders/route'
import { POST as createSale } from '@/app/api/v1/sales/route'
import { adminClient, createCustomer, createProduct, ensureTestUsers, stockOf, uniq } from '../helpers/integration'
import { dataOf, errorOf, loginAs, TestClient } from '../helpers/http'

let cashier: TestClient
let manager: TestClient

beforeAll(async () => {
    await ensureTestUsers()
    ;[cashier, manager] = await Promise.all([loginAs('cashier'), loginAs('manager')])
})

interface Order {
    id: string
    order_number: string
    status: string
    subtotal: number
    tax: number
    discount: number
    total: number
    customer_id: string | null
    items: Array<{ product_id: string; quantity: number; unit_price: number; tax: number; total: number }>
    payments: Array<{ payment_method: string; amount: number }>
    refund_reason: string | null
}

const sale = (client: TestClient, body: unknown) => client.post(createSale, 'sales', { body })

describe('POST /sales', () => {
    test('needs a session', async () => {
        expect((await sale(new TestClient(), { items: [], payment_method: 'cash' })).status).toBe(401)
    })

    test('prices, tax and totals come from the database; whatever the client sends is ignored', async () => {
        const product = await createProduct({ selling_price: 29.99, tax_rate: 0.1, stock: 10 })
        const response = await sale(cashier, {
            payment_method: 'cash',
            total: 0.01,
            items: [{ product_id: product.id, quantity: 2, unit_price: 0.01, tax: 0, total: 0.01 }]
        })
        expect(response.status).toBe(201)
        const order = dataOf<Order>(response)
        expect(order).toMatchObject({
            status: 'completed',
            subtotal: 59.98,
            tax: 6,
            discount: 0,
            total: 65.98,
            customer_id: null
        })
        expect(order.items[0]).toMatchObject({
            product_id: product.id,
            quantity: 2,
            unit_price: 29.99,
            tax: 6,
            total: 65.98
        })
        expect(order.payments).toEqual([expect.objectContaining({ payment_method: 'cash', amount: 65.98 })])
        expect(order.order_number).toMatch(/^ORD-\d{6}-\d{6}$/)
        expect(await stockOf(product.id)).toBe(8)
    })

    test('tax is rounded per line and the global discount applies after tax', async () => {
        const a = await createProduct({ selling_price: 1.15, tax_rate: 0.07, stock: 5 }) // tax 0.0805 -> 0.08
        const b = await createProduct({ selling_price: 20, tax_rate: 0.1, stock: 5 })
        const order = dataOf<Order>(
            await sale(cashier, {
                payment_method: 'card',
                discount: 2,
                items: [
                    { product_id: a.id, quantity: 1 },
                    { product_id: b.id, quantity: 1, discount: 5 } // taxable base 15 -> tax 1.5
                ]
            })
        )
        expect(order.subtotal).toBe(16.15)
        expect(order.tax).toBe(1.58)
        expect(order.discount).toBe(2)
        expect(order.total).toBe(15.73) // 16.15 + 1.58 - 2
    })

    test('a failing line rolls the whole sale back: no order, no stock movement', async () => {
        const fine = await createProduct({ stock: 5 })
        const scarce = await createProduct({ stock: 1 })
        const admin = adminClient()
        const { count: before } = await admin.from('orders').select('*', { count: 'exact', head: true })

        const response = await sale(cashier, {
            payment_method: 'cash',
            items: [
                { product_id: fine.id, quantity: 2 },
                { product_id: scarce.id, quantity: 2 }
            ]
        })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toMatch(/^Insufficient stock for "/)
        expect(await stockOf(fine.id)).toBe(5)
        expect(await stockOf(scarce.id)).toBe(1)
        const { count: after } = await admin.from('orders').select('*', { count: 'exact', head: true })
        expect(after).toBe(before)
    })

    test('rejects an empty cart, bad quantities, unknown/deleted/inactive products and unknown customers', async () => {
        const product = await createProduct({ stock: 5 })
        const deleted = await createProduct({ stock: 5 })
        const inactive = await createProduct({ stock: 5, is_active: false })
        await adminClient().from('products').update({ deleted_at: new Date().toISOString() }).eq('id', deleted.id)

        expect((await sale(cashier, { payment_method: 'cash', items: [] })).status).toBe(422)
        expect(
            (await sale(cashier, { payment_method: 'cash', items: [{ product_id: product.id, quantity: 0 }] })).status
        ).toBe(422)
        expect(
            (await sale(cashier, { payment_method: 'bitcoin', items: [{ product_id: product.id, quantity: 1 }] }))
                .status
        ).toBe(422)
        for (const id of [crypto.randomUUID(), deleted.id, inactive.id]) {
            const response = await sale(cashier, { payment_method: 'cash', items: [{ product_id: id, quantity: 1 }] })
            expect(response.status).toBe(422)
            expect(errorOf(response).message).toBe('Product not available')
        }
        const noCustomer = await sale(cashier, {
            payment_method: 'cash',
            customer_id: crypto.randomUUID(),
            items: [{ product_id: product.id, quantity: 1 }]
        })
        expect(errorOf(noCustomer).message).toBe('Customer not available')
        expect(await stockOf(product.id)).toBe(5)
    })

    test('a discount larger than the order is refused', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const response = await sale(cashier, {
            payment_method: 'cash',
            discount: 999,
            items: [{ product_id: product.id, quantity: 1 }]
        })
        expect(response.status).toBe(422)
        expect(await stockOf(product.id)).toBe(5)
    })

    test('a sale for a customer updates their derived spending and points', async () => {
        const customer = await createCustomer()
        const product = await createProduct({ selling_price: 100, tax_rate: 0, stock: 5 })
        await sale(cashier, {
            customer_id: customer.id,
            payment_method: 'cash',
            items: [{ product_id: product.id, quantity: 2 }]
        })
        const { data } = await adminClient()
            .from('customers')
            .select('total_spent, loyalty_points')
            .eq('id', customer.id)
            .single()
        expect(data).toEqual({ total_spent: 200, loyalty_points: 200 })
    })
})

describe('orders', () => {
    test('a cashier sees only their own orders; a manager sees everyone’s', async () => {
        const product = await createProduct({ stock: 10 })
        const mine = dataOf<Order>(
            await sale(cashier, { payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )
        const theirs = dataOf<Order>(
            await sale(manager, { payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )

        const cashierList = (await cashier.get(listOrders, 'orders?pageSize=100')).json<{
            data: Array<{ id: string }>
        }>().data
        expect(cashierList.some(order => order.id === mine.id)).toBe(true)
        expect(cashierList.some(order => order.id === theirs.id)).toBe(false)
        expect((await cashier.get(getOrder, `orders/${theirs.id}`, { params: { id: theirs.id } })).status).toBe(404)

        const managerList = (await manager.get(listOrders, 'orders?pageSize=100')).json<{
            data: Array<{ id: string }>
        }>().data
        expect(managerList.map(order => order.id)).toEqual(expect.arrayContaining([mine.id, theirs.id]))
        const detail = dataOf<Order & { created_by_name: string }>(
            await manager.get(getOrder, `orders/${mine.id}`, { params: { id: mine.id } })
        )
        expect(detail.created_by_name).toBe('cashier@barstock.test')
    })

    test('filters by status and searches by order number', async () => {
        const product = await createProduct({ stock: 5 })
        const order = dataOf<Order>(
            await sale(cashier, { payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )
        const found = (await cashier.get(listOrders, `orders?q=${order.order_number}`)).json<{ total: number }>()
        expect(found.total).toBe(1)
        expect(
            (await cashier.get(listOrders, 'orders?status=refunded&q=' + order.order_number)).json<{ total: number }>()
                .total
        ).toBe(0)
        expect((await cashier.get(listOrders, 'orders?status=exploded')).status).toBe(422)
    })

    test('unknown order is a 404', async () => {
        const id = crypto.randomUUID()
        expect((await manager.get(getOrder, `orders/${id}`, { params: { id } })).status).toBe(404)
    })
})

describe('refunds', () => {
    test('cashiers cannot refund; managers can, with a mandatory reason, and stock comes back', async () => {
        const product = await createProduct({ stock: 10 })
        const order = dataOf<Order>(
            await sale(cashier, { payment_method: 'cash', items: [{ product_id: product.id, quantity: 3 }] })
        )
        const params = { id: order.id }
        expect(await stockOf(product.id)).toBe(7)

        expect(
            (await cashier.post(refund, `orders/${order.id}/refund`, { params, body: { reason: 'changed my mind' } }))
                .status
        ).toBe(403)
        expect((await manager.post(refund, `orders/${order.id}/refund`, { params, body: {} })).status).toBe(422)
        expect(
            (await manager.post(refund, `orders/${order.id}/refund`, { params, body: { reason: 'ok' } })).status
        ).toBe(422)
        expect(await stockOf(product.id)).toBe(7)

        const done = await manager.post(refund, `orders/${order.id}/refund`, {
            params,
            body: { reason: 'Customer returned the goods' }
        })
        expect(done.status).toBe(200)
        expect(dataOf<Order>(done)).toMatchObject({ status: 'refunded', refund_reason: 'Customer returned the goods' })
        expect(await stockOf(product.id)).toBe(10)
    })

    test('refunding twice is safe: the stock is restored once', async () => {
        const product = await createProduct({ stock: 4 })
        const order = dataOf<Order>(
            await sale(cashier, { payment_method: 'cash', items: [{ product_id: product.id, quantity: 4 }] })
        )
        const params = { id: order.id }
        const body = { reason: 'duplicate click' }
        expect((await manager.post(refund, `orders/${order.id}/refund`, { params, body })).status).toBe(200)
        expect((await manager.post(refund, `orders/${order.id}/refund`, { params, body })).status).toBe(200)
        expect(await stockOf(product.id)).toBe(4)
        const { count } = await adminClient()
            .from('inventory_transactions')
            .select('*', { count: 'exact', head: true })
            .eq('reference_id', order.id)
            .eq('transaction_type', 'return')
        expect(count).toBe(1)
    })

    test('refunding a customer’s sale takes the spending and points back', async () => {
        const customer = await createCustomer()
        const product = await createProduct({ selling_price: 50, tax_rate: 0, stock: 5 })
        const order = dataOf<Order>(
            await sale(cashier, {
                customer_id: customer.id,
                payment_method: 'cash',
                items: [{ product_id: product.id, quantity: 1 }]
            })
        )
        await manager.post(refund, `orders/${order.id}/refund`, {
            params: { id: order.id },
            body: { reason: 'returned' }
        })
        const { data } = await adminClient()
            .from('customers')
            .select('total_spent, loyalty_points')
            .eq('id', customer.id)
            .single()
        expect(data).toEqual({ total_spent: 0, loyalty_points: 0 })
    })

    test('an unknown order is a 404', async () => {
        const id = crypto.randomUUID()
        expect(
            (await manager.post(refund, `orders/${id}/refund`, { params: { id }, body: { reason: 'does not exist' } }))
                .status
        ).toBe(404)
    })
})

describe('inventory', () => {
    const rowFor = async (client: TestClient, productName: string) => {
        const list = (await client.get(listInventory, `inventory?q=${encodeURIComponent(productName)}`)).json<{
            data: Array<{ id: string; quantity: number }>
            summary: { total_units: number; item_count: number; low_stock_count: number; stock_value: number }
        }>()
        return list
    }

    test('adjusting stock is for managers, needs a reason, and records the movement', async () => {
        const product = await createProduct({ stock: 5 })
        const inventory = (await rowFor(cashier, product.name)).data[0]
        if (!inventory) throw new Error('inventory row missing')
        const params = { id: inventory.id }

        expect(
            (
                await cashier.post(adjust, `inventory/${inventory.id}/adjust`, {
                    params,
                    body: { delta: 1, reason: 'sneaky' }
                })
            ).status
        ).toBe(403)
        expect(
            (await manager.post(adjust, `inventory/${inventory.id}/adjust`, { params, body: { delta: 1 } })).status
        ).toBe(422)
        expect(
            (
                await manager.post(adjust, `inventory/${inventory.id}/adjust`, {
                    params,
                    body: { delta: 0, reason: 'nothing' }
                })
            ).status
        ).toBe(422)

        const up = await manager.post(adjust, `inventory/${inventory.id}/adjust`, {
            params,
            body: { delta: '12', reason: 'New delivery' }
        })
        expect(dataOf<{ quantity: number }>(up).quantity).toBe(17)
        expect(await stockOf(product.id)).toBe(17)

        const { data } = await adminClient()
            .from('inventory_transactions')
            .select('transaction_type, quantity, notes')
            .eq('inventory_id', inventory.id)
        expect(data).toEqual([{ transaction_type: 'adjustment', quantity: 12, notes: 'New delivery' }])
    })

    test('stock can never go negative', async () => {
        const product = await createProduct({ stock: 3 })
        const inventory = (await rowFor(manager, product.name)).data[0]
        if (!inventory) throw new Error('inventory row missing')
        const response = await manager.post(adjust, `inventory/${inventory.id}/adjust`, {
            params: { id: inventory.id },
            body: { delta: -4, reason: 'recount' }
        })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toBe('The adjustment would make the stock negative')
        expect(await stockOf(product.id)).toBe(3)
        const missing = crypto.randomUUID()
        expect(
            (
                await manager.post(adjust, `inventory/${missing}/adjust`, {
                    params: { id: missing },
                    body: { delta: 1, reason: 'ghost' }
                })
            ).status
        ).toBe(404)
    })

    test('the summary and the low-stock filter use each item’s own threshold', async () => {
        const tag = uniq('lowstock')
        await createProduct({ name: `${tag} low`, stock: 2, threshold: 5 })
        await createProduct({ name: `${tag} edge`, stock: 5, threshold: 5 }) // at the threshold counts as low
        await createProduct({ name: `${tag} fine`, stock: 6, threshold: 5, cost_price: 2.5 })

        const all = await rowFor(cashier, tag)
        expect(all.summary).toMatchObject({
            item_count: 3,
            total_units: 13,
            low_stock_count: 2,
            stock_value: 0 * 2 + 0 * 5 + 6 * 2.5 + (2 + 5) * 4
        })
        const low = (await cashier.get(listInventory, `inventory?q=${tag}&low=true`)).json<{ total: number }>()
        expect(low.total).toBe(2)
    })
})
