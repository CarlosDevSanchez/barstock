import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GET as dashboard } from '@/app/api/v1/dashboard/route'
import { GET as report } from '@/app/api/v1/reports/route'
import { GET as getSettings, PATCH as patchSettings } from '@/app/api/v1/settings/route'
import { PATCH as patchUser } from '@/app/api/v1/users/[id]/route'
import { GET as listUsers } from '@/app/api/v1/users/route'
import { POST as createSale } from '@/app/api/v1/sales/route'
import { POST as refund } from '@/app/api/v1/orders/[id]/refund/route'
import {
    adminClient,
    createCustomer,
    createProduct,
    ensureTestUsers,
    uniq,
    type TestUsers
} from '../helpers/integration'
import { dataOf, errorOf, loginAs, TestClient } from '../helpers/http'

let users: TestUsers
let cashier: TestClient
let manager: TestClient
let admin: TestClient

beforeAll(async () => {
    users = await ensureTestUsers()
    ;[cashier, manager, admin] = await Promise.all([loginAs('cashier'), loginAs('manager'), loginAs('admin')])
    storeTimeZone = dataOf<{ timezone: string }>(await cashier.get(getSettings, 'settings')).timezone
})

/** Today's date (YYYY-MM-DD) in the store's time zone: the dashboard buckets days with settings.timezone. */
let storeTimeZone = 'UTC'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: storeTimeZone })

interface Dashboard {
    today_revenue: number
    today_orders: number
    month_revenue: number
    total_customers: number
    low_stock_count: number
    sales_last_7_days: Array<{ date: string; revenue: number; orders: number }>
    top_products: Array<{ name: string; quantity: number }>
    low_stock_items: Array<{ product_name: string; quantity: number; low_stock_threshold: number }>
}

describe('dashboard', () => {
    test('needs a session and returns the whole contract', async () => {
        expect((await new TestClient().get(dashboard, 'dashboard')).status).toBe(401)
        const summary = dataOf<Dashboard>(await cashier.get(dashboard, 'dashboard'))
        expect(summary.sales_last_7_days).toHaveLength(7)
        expect(summary.sales_last_7_days.at(-1)?.date).toBe(today())
    })

    test('a cashier’s dashboard counts only their own sales; a manager’s counts everyone’s', async () => {
        const product = await createProduct({ selling_price: 100, tax_rate: 0, stock: 20 })
        const mineBefore = dataOf<Dashboard>(await cashier.get(dashboard, 'dashboard'))
        const allBefore = dataOf<Dashboard>(await manager.get(dashboard, 'dashboard'))

        await cashier.post(createSale, 'sales', {
            body: { payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] }
        })
        await manager.post(createSale, 'sales', {
            body: { payment_method: 'cash', items: [{ product_id: product.id, quantity: 2 }] }
        })

        const mineAfter = dataOf<Dashboard>(await cashier.get(dashboard, 'dashboard'))
        const allAfter = dataOf<Dashboard>(await manager.get(dashboard, 'dashboard'))
        expect(mineAfter.today_revenue - mineBefore.today_revenue).toBeCloseTo(100, 2)
        expect(mineAfter.today_orders - mineBefore.today_orders).toBe(1)
        expect(allAfter.today_revenue - allBefore.today_revenue).toBeCloseTo(300, 2)
        expect(allAfter.today_orders - allBefore.today_orders).toBe(2)
    })

    test('refunded orders leave the totals', async () => {
        const product = await createProduct({ selling_price: 40, tax_rate: 0, stock: 5 })
        const before = dataOf<Dashboard>(await manager.get(dashboard, 'dashboard'))
        const order = dataOf<{ id: string }>(
            await manager.post(createSale, 'sales', {
                body: { payment_method: 'card', items: [{ product_id: product.id, quantity: 1 }] }
            })
        )
        expect(dataOf<Dashboard>(await manager.get(dashboard, 'dashboard')).today_revenue - before.today_revenue).toBe(
            40
        )
        await manager.post(refund, `orders/${order.id}/refund`, {
            params: { id: order.id },
            body: { reason: 'returned' }
        })
        expect(dataOf<Dashboard>(await manager.get(dashboard, 'dashboard')).today_revenue).toBeCloseTo(
            before.today_revenue,
            2
        )
    })

    test('low stock is counted per item threshold and listed', async () => {
        const name = uniq('dashlow')
        await createProduct({ name, stock: 1, threshold: 3 })
        const summary = dataOf<Dashboard>(await cashier.get(dashboard, 'dashboard'))
        expect(summary.low_stock_count).toBeGreaterThanOrEqual(1)
        const all = await adminClient()
            .from('inventory')
            .select('quantity, low_stock_threshold, products!inner(deleted_at, is_active)')
            .is('variant_id', null)
        const expected = (all.data ?? []).filter(
            row => row.quantity <= row.low_stock_threshold && row.products.is_active && !row.products.deleted_at
        ).length
        expect(summary.low_stock_count).toBe(expected)
    })
})

interface Report {
    total_orders: number
    total_revenue: number
    total_tax: number
    total_discount: number
    average_order: number
    daily: Array<{ date: string; revenue: number; orders: number }>
    top_products: Array<{ product_id: string; name: string; quantity: number; revenue: number }>
    top_customers: Array<{ customer_id: string; name: string; orders: number; spent: number }>
    by_payment_method: Array<{ method: string; orders: number; amount: number }>
}

describe('reports', () => {
    test('managers and admins only', async () => {
        const range = `reports?from=${today()}&to=${today()}`
        expect((await new TestClient().get(report, range)).status).toBe(401)
        expect((await cashier.get(report, range)).status).toBe(403)
        expect((await manager.get(report, range)).status).toBe(200)
        expect((await admin.get(report, range)).status).toBe(200)
    })

    test('validates the range', async () => {
        expect((await manager.get(report, 'reports')).status).toBe(422)
        expect((await manager.get(report, 'reports?from=yesterday&to=today')).status).toBe(422)
        expect((await manager.get(report, `reports?from=${today()}&to=2000-01-01`)).status).toBe(422)
        expect((await manager.get(report, 'reports?from=2020-01-01&to=2026-01-01')).status).toBe(422) // more than 366 days
    })

    // The database is shared and grows with every run, so "today" cannot be asserted exactly. These orders are dated on a random
    // day in the past (service_role, bypassing the RPC only to backdate them), so the report for that one day is fully known.
    test('aggregates completed orders only and breaks them down (exact figures for an isolated day)', async () => {
        const db = adminClient()
        const day = new Date(Date.UTC(2000, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000)
            .toISOString()
            .slice(0, 10)
        const at = `${day}T12:00:00Z`
        const [p1, p2, customer] = await Promise.all([
            createProduct({ name: uniq('ReportedA') }),
            createProduct({ name: uniq('ReportedB') }),
            createCustomer({ name: uniq('Regular') })
        ])

        const order = async (
            status: 'completed' | 'refunded',
            method: 'card' | 'cash',
            line: { product: string; quantity: number; unit: number; tax: number },
            discount: number
        ) => {
            const base = line.quantity * line.unit
            const total = base + line.tax - discount
            const { data, error } = await db
                .from('orders')
                .insert({
                    order_number: uniq('BACKDATED'),
                    status,
                    subtotal: base,
                    tax: line.tax,
                    discount,
                    total,
                    customer_id: customer.id,
                    created_at: at
                })
                .select('id')
                .single()
            if (error) throw error
            const orderId = data.id
            await db.from('order_items').insert({
                order_id: orderId,
                product_id: line.product,
                quantity: line.quantity,
                unit_price: line.unit,
                discount: 0,
                tax: line.tax,
                total: base + line.tax
            })
            await db.from('payments').insert({ order_id: orderId, payment_method: method, amount: total })
        }
        await order('completed', 'card', { product: p1.id, quantity: 2, unit: 50, tax: 10 }, 5) // total 105, line 110
        await order('completed', 'cash', { product: p2.id, quantity: 1, unit: 30, tax: 0 }, 0) // total 30, line 30
        await order('refunded', 'cash', { product: p1.id, quantity: 9, unit: 50, tax: 45 }, 0) // excluded from everything

        const data = dataOf<Report>(await manager.get(report, `reports?from=${day}&to=${day}`))
        expect(data).toMatchObject({
            total_orders: 2,
            total_revenue: 135,
            total_tax: 10,
            total_discount: 5,
            average_order: 67.5
        })
        expect(data.daily).toEqual([{ date: day, revenue: 135, orders: 2 }])
        expect(data.top_products).toEqual([
            { product_id: p1.id, name: p1.name, quantity: 2, revenue: 110 },
            { product_id: p2.id, name: p2.name, quantity: 1, revenue: 30 }
        ])
        expect(data.top_customers).toEqual([{ customer_id: customer.id, name: customer.name, orders: 2, spent: 135 }])
        expect(data.by_payment_method).toEqual([
            { method: 'card', orders: 1, amount: 105 },
            { method: 'cash', orders: 1, amount: 30 }
        ])

        // A day with no sales is empty (and still zero-filled in the daily series).
        const empty = dataOf<Report>(await manager.get(report, 'reports?from=1999-12-31&to=1999-12-31'))
        expect(empty).toMatchObject({ total_orders: 0, total_revenue: 0, average_order: 0 })
        expect(empty.daily).toEqual([{ date: '1999-12-31', revenue: 0, orders: 0 }])
    })
})

describe('settings', () => {
    let original: Record<string, unknown>

    beforeAll(async () => {
        original = dataOf<Record<string, unknown>>(await cashier.get(getSettings, 'settings'))
    })
    afterAll(async () => {
        await admin.patch(patchSettings, 'settings', { body: original })
    })

    test('everyone signed in reads them, with defaults filled in', async () => {
        expect((await new TestClient().get(getSettings, 'settings')).status).toBe(401)
        const settings = dataOf<{ currency: string; timezone: string; store_name: string }>(
            await cashier.get(getSettings, 'settings')
        )
        expect(settings.currency).toMatch(/^[A-Z]{3}$/)
        expect(settings.timezone.length).toBeGreaterThan(0)
        expect(settings.store_name.length).toBeGreaterThan(0)
    })

    test('only an admin writes them', async () => {
        expect((await cashier.patch(patchSettings, 'settings', { body: { store_name: 'Hacked' } })).status).toBe(403)
        expect((await manager.patch(patchSettings, 'settings', { body: { store_name: 'Hacked' } })).status).toBe(403)
        const saved = await admin.patch(patchSettings, 'settings', {
            body: { store_name: 'Barstock Test Shop', currency: 'EUR', tax_rate: 0.21 }
        })
        expect(saved.status).toBe(200)
        expect(
            dataOf<{ store_name: string; currency: string }>(await cashier.get(getSettings, 'settings'))
        ).toMatchObject({
            store_name: 'Barstock Test Shop',
            currency: 'EUR'
        })
    })

    test('validates every value', async () => {
        for (const body of [
            { currency: 'eur' },
            { currency: 'ZZZ' },
            { timezone: 'Mars/Base' },
            { tax_rate: 21 },
            { store_email: 'nope' },
            { low_stock_threshold: -1 }
        ]) {
            expect((await admin.patch(patchSettings, 'settings', { body })).status).toBe(422)
        }
    })

    test('a corrupt stored value falls back to the default instead of breaking the app', async () => {
        await adminClient().from('settings').update({ value: 'not-a-currency-at-all' }).eq('key', 'currency')
        const settings = dataOf<{ currency: string }>(await cashier.get(getSettings, 'settings'))
        expect(settings.currency).toBe('COP') // SETTINGS_DEFAULTS
    })
})

describe('users', () => {
    test('only admins list users', async () => {
        expect((await cashier.get(listUsers, 'users')).status).toBe(403)
        expect((await manager.get(listUsers, 'users')).status).toBe(403)
        const list = (await admin.get(listUsers, 'users?pageSize=100')).json<{
            data: Array<{ email: string; role: string }>
        }>().data
        expect(list.find(user => user.email === 'manager@barstock.test')?.role).toBe('manager')
    })

    test('an admin changes roles and disables accounts; the change takes effect immediately', async () => {
        const victim = await loginAs('cashier')
        const id = users.cashier.id
        try {
            const promoted = await admin.patch(patchUser, `users/${id}`, { params: { id }, body: { role: 'manager' } })
            expect(dataOf<{ role: string }>(promoted).role).toBe('manager')
            // Same session, no re-login: the role is read from the database on every request.
            expect((await victim.get(report, `reports?from=${today()}&to=${today()}`)).status).toBe(200)

            await admin.patch(patchUser, `users/${id}`, { params: { id }, body: { role: 'cashier', is_active: false } })
            expect((await victim.get(dashboard, 'dashboard')).status).toBe(401)
        } finally {
            await adminClient().from('profiles').update({ role: 'cashier', is_active: true }).eq('id', id)
        }
    })

    test('non-admins cannot change anyone, and nobody can remove their own admin access', async () => {
        const id = users.cashier.id
        expect(
            (await cashier.patch(patchUser, `users/${id}`, { params: { id }, body: { role: 'admin' } })).status
        ).toBe(403)
        expect(
            (await manager.patch(patchUser, `users/${id}`, { params: { id }, body: { role: 'admin' } })).status
        ).toBe(403)
        const self = users.admin.id
        for (const body of [{ is_active: false }, { role: 'cashier' }]) {
            const response = await admin.patch(patchUser, `users/${self}`, { params: { id: self }, body })
            expect(response.status).toBe(422)
            expect(errorOf(response).message).toMatch(/cannot/)
        }
        expect((await admin.patch(patchUser, `users/${id}`, { params: { id }, body: {} })).status).toBe(422)
        const missing = crypto.randomUUID()
        expect(
            (await admin.patch(patchUser, `users/${missing}`, { params: { id: missing }, body: { is_active: false } }))
                .status
        ).toBe(404)
    })
})
