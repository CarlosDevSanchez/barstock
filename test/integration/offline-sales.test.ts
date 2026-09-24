import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GET as getOrder } from '@/app/api/v1/orders/[id]/route'
import { PATCH as reviewOrder } from '@/app/api/v1/orders/[id]/review/route'
import { GET as listOrders } from '@/app/api/v1/orders/route'
import { POST as createSale } from '@/app/api/v1/sales/route'
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
import { dataOf, errorOf, loginAs, type TestClient } from '../helpers/http'

interface Order {
    id: string
    total: number
    client_ref: string | null
    occurred_at: string | null
    source: 'online' | 'offline'
    sync_issues: Record<string, unknown> | null
    reviewed_by: string | null
    reviewed_at: string | null
    payments: Array<{ amount: number }>
    items: Array<{ product_id: string; quantity: number }>
}

let cashier: TestClient
let managerClient: TestClient
let manager: Db
let restoreCurrency: () => Promise<void>

/** Pins `settings.offline_max_hours` for a test, restoring the previous value in the returned cleanup. */
async function pinOfflineMaxHours(hours: number): Promise<() => Promise<void>> {
    const admin = adminClient()
    const { data, error } = await admin.from('settings').select('value').eq('key', 'offline_max_hours').single()
    const previous = error ? undefined : data.value
    const { error: writeError } = await admin
        .from('settings')
        .upsert({ key: 'offline_max_hours', value: hours as never }, { onConflict: 'key' })
    if (writeError) throw writeError
    return async () => {
        if (previous === undefined) {
            await admin.from('settings').delete().eq('key', 'offline_max_hours')
        } else {
            await admin.from('settings').upsert({ key: 'offline_max_hours', value: previous }, { onConflict: 'key' })
        }
    }
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const sale = (body: unknown) => cashier.post(createSale, 'sales', { body })

beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
    ;[cashier, managerClient, manager] = await Promise.all([
        loginAs('cashier'),
        loginAs('manager'),
        signedInClient('manager')
    ])
})
afterAll(async () => {
    await restoreCurrency()
})

describe('offline sales (create_sale: p_occurred_at / p_expected_total)', () => {
    test('an offline sale within the window is recorded as-is: source, occurred_at, no sync_issues', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const occurredAt = hoursAgo(2)
        const response = await sale({
            payment_method: 'cash',
            occurred_at: occurredAt,
            items: [{ product_id: product.id, quantity: 1 }]
        })
        expect(response.status).toBe(201)
        const order = dataOf<Order>(response)
        expect(order.source).toBe('offline')
        expect(new Date(order.occurred_at!).getTime()).toBe(new Date(occurredAt).getTime())
        expect(order.sync_issues).toBeNull()
    })

    test('without occurred_at, the sale is online and occurred_at stays null', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const order = dataOf<Order>(
            await sale({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )
        expect(order.source).toBe('online')
        expect(order.occurred_at).toBeNull()
    })

    test('client_ref mirrors the idempotency key, and is null without one', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const key = crypto.randomUUID()
        const withKey = dataOf<Order>(
            await cashier.post(createSale, 'sales', {
                body: { payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] },
                headers: { 'Idempotency-Key': key }
            })
        )
        expect(withKey.client_ref).toBe(key)

        const withoutKey = dataOf<Order>(
            await sale({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )
        expect(withoutKey.client_ref).toBeNull()
    })

    test('occurred_at older than offline_max_hours is clamped, and the clamp is recorded', async () => {
        const restoreWindow = await pinOfflineMaxHours(1)
        try {
            const product = await createProduct({ selling_price: 10, stock: 5 })
            const requested = hoursAgo(5)
            const order = dataOf<Order>(
                await sale({
                    payment_method: 'cash',
                    occurred_at: requested,
                    items: [{ product_id: product.id, quantity: 1 }]
                })
            )
            expect(new Date(order.occurred_at!).getTime()).toBeGreaterThan(new Date(requested).getTime())
            const issues = order.sync_issues as { occurred_at_clamped: { requested: string; used: string } }
            expect(new Date(issues.occurred_at_clamped.requested).getTime()).toBe(new Date(requested).getTime())
            expect(new Date(issues.occurred_at_clamped.used).getTime()).toBe(new Date(order.occurred_at!).getTime())
        } finally {
            await restoreWindow()
        }
    })

    test('occurred_at in the future is clamped to now', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const future = new Date(Date.now() + 3_600_000).toISOString()
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: future,
                items: [{ product_id: product.id, quantity: 1 }]
            })
        )
        expect(new Date(order.occurred_at!).getTime()).toBeLessThan(new Date(future).getTime())
        expect(order.sync_issues).toHaveProperty('occurred_at_clamped')
    })

    test('an expected_total that does not match the server total is recorded, never trusted', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                expected_total: 999,
                items: [{ product_id: product.id, quantity: 1 }]
            })
        )
        expect(order.total).toBe(10) // the server's total, not the client's
        expect(order.payments[0]?.amount).toBe(10)
        expect(order.sync_issues).toMatchObject({ price_mismatch: { expected: 999, actual: 10 } })
    })

    test('a matching expected_total leaves no price_mismatch', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                expected_total: 10,
                items: [{ product_id: product.id, quantity: 1 }]
            })
        )
        expect(order.sync_issues).toBeNull()
    })

    test('an offline sale short on stock is still recorded: stock floors at 0, the shortfall is noted, never rejected', async () => {
        const product = await createProduct({ selling_price: 10, stock: 2 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: product.id, quantity: 5 }]
            })
        )
        expect(order.items[0]).toMatchObject({ product_id: product.id, quantity: 5 }) // sold in full: the money is in
        expect(await stockOf(product.id)).toBe(0) // floored, never negative
        expect(order.sync_issues).toMatchObject({ stock_shortfall: [{ product_id: product.id, missing: 3 }] })
    })

    test('the same shortage online is rejected outright, with no side effects (unchanged behaviour)', async () => {
        const product = await createProduct({ selling_price: 10, stock: 2 })
        const response = await sale({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 5 }] })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toMatch(/^Insufficient stock/)
        expect(await stockOf(product.id)).toBe(2)
    })

    test('offline sale, exact stock available: no shortfall is recorded', async () => {
        const product = await createProduct({ selling_price: 10, stock: 3 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: product.id, quantity: 3 }]
            })
        )
        expect(await stockOf(product.id)).toBe(0)
        expect(order.sync_issues).toBeNull()
    })

    test('an inactive product is still rejected offline: no price to compute from', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5, is_active: false })
        const response = await sale({
            payment_method: 'cash',
            occurred_at: hoursAgo(1),
            items: [{ product_id: product.id, quantity: 1 }]
        })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toBe('Product not available')
    })

    test('GET /orders/:id returns the same offline fields', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const created = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: product.id, quantity: 1 }]
            })
        )
        const fetched = dataOf<Order>(
            await cashier.get(getOrder, `orders/${created.id}`, { params: { id: created.id } })
        )
        expect(fetched).toMatchObject({ source: 'offline', occurred_at: created.occurred_at })
    })
})

describe('reporting groups by when the sale happened, not when it reached the server', () => {
    test('sales_report attributes an offline sale to its occurred_at day, days after the row was created', async () => {
        const restoreWindow = await pinOfflineMaxHours(240) // 10 days: keeps occurred_at from being clamped
        try {
            const product = await createProduct({ selling_price: 25, tax_rate: 0, stock: 5 })
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3_600_000)
            const occurredAt = new Date(
                Date.UTC(threeDaysAgo.getUTCFullYear(), threeDaysAgo.getUTCMonth(), threeDaysAgo.getUTCDate(), 12)
            ).toISOString()
            const day = occurredAt.slice(0, 10)

            const order = dataOf<Order>(
                await sale({
                    payment_method: 'cash',
                    occurred_at: occurredAt,
                    items: [{ product_id: product.id, quantity: 1 }]
                })
            )
            expect(order.sync_issues).toBeNull() // not clamped: proves the window pin took effect

            const { data, error } = await manager.rpc('sales_report', { p_from: day, p_to: day, p_tz: 'UTC' })
            if (error) throw error
            const report = data as { total_orders: number; total_revenue: number }
            // created_at for this row is "today", 3 days after `day`: if grouping still used created_at, this
            // day's report would show none of it.
            expect(report.total_orders).toBeGreaterThanOrEqual(1)
            expect(report.total_revenue).toBeGreaterThanOrEqual(25)
        } finally {
            await restoreWindow()
        }
    })
})

describe('manager review of a synced-with-issues order (F4)', () => {
    const review = (id: string) => managerClient.patch(reviewOrder, `orders/${id}/review`, { params: { id } })

    test('needs a session, and only a manager+', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: product.id, quantity: 3 }]
            })
        )
        expect(
            (await cashier.patch(reviewOrder, `orders/${order.id}/review`, { params: { id: order.id } })).status
        ).toBe(403)
        expect(await review(order.id)).toMatchObject({ status: 200 })
    })

    test('marks reviewed_by/reviewed_at, and the order carries them afterwards', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: product.id, quantity: 3 }]
            })
        )
        expect(order.reviewed_at).toBeNull()

        const reviewed = dataOf<Order>(await review(order.id))
        expect(reviewed.reviewed_by).not.toBeNull()
        expect(reviewed.reviewed_at).not.toBeNull()

        const fetched = dataOf<Order>(await cashier.get(getOrder, `orders/${order.id}`, { params: { id: order.id } }))
        expect(fetched.reviewed_at).toBe(reviewed.reviewed_at)
    })

    test('reviewing twice just refreshes who/when (idempotent, not an error)', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: product.id, quantity: 3 }]
            })
        )
        const first = dataOf<Order>(await review(order.id))
        const second = dataOf<Order>(await review(order.id))
        expect(second.reviewed_by).toBe(first.reviewed_by)
    })

    test('an order with no sync_issues has nothing to review', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const order = dataOf<Order>(
            await sale({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )
        expect(order.sync_issues).toBeNull()
        const response = await review(order.id)
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toBe('This order has no sync issues to review')
    })

    test('a missing order is 404', async () => {
        const response = await review(crypto.randomUUID())
        expect(response.status).toBe(404)
    })

    test('GET /orders?needs_review=true lists only unreviewed sync_issues, and drops one once reviewed', async () => {
        const tag = uniq('review')
        const productA = await createProduct({ name: `${tag}-a`, selling_price: 10, tax_rate: 0, stock: 1 })
        const productB = await createProduct({ name: `${tag}-b`, selling_price: 10, tax_rate: 0, stock: 1 })
        const withIssue = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: productA.id, quantity: 3 }]
            })
        )
        const clean = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                occurred_at: hoursAgo(1),
                items: [{ product_id: productB.id, quantity: 1 }]
            })
        )
        expect(clean.sync_issues).toBeNull()

        const before = await managerClient.get(listOrders, `orders?needs_review=true&pageSize=100`)
        const beforeIds = dataOf<Order[]>(before).map(order => order.id)
        expect(beforeIds).toContain(withIssue.id)
        expect(beforeIds).not.toContain(clean.id)

        await review(withIssue.id)

        const after = await managerClient.get(listOrders, `orders?needs_review=true&pageSize=100`)
        expect(dataOf<Order[]>(after).map(order => order.id)).not.toContain(withIssue.id)
    })
})
