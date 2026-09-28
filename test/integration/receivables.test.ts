import { beforeAll, describe, expect, test } from 'bun:test'
import { POST as writeOffRoute } from '@/app/api/v1/receivables/[id]/write-off/route'
import {
    adminClient,
    createCustomer,
    createProduct,
    ensureTestUsers,
    signedInClient,
    uniq,
    type Db
} from '../helpers/integration'
import { loginAs, type TestClient } from '../helpers/http'

let cashier: Db
let manager: Db
let cashierHttp: TestClient
let adminHttp: TestClient

const service = () => adminClient()

/** Phase E RPCs are not in generated types until `bun run db:types`. */
function rpc(client: Db, fn: string, args: Record<string, unknown>) {
    return (
        client as unknown as {
            rpc: (
                f: string,
                a: Record<string, unknown>
            ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>
        }
    ).rpc(fn, args)
}

beforeAll(async () => {
    await ensureTestUsers()
    ;[cashier, manager] = await Promise.all([signedInClient('cashier'), signedInClient('manager')])
    ;[cashierHttp, adminHttp] = await Promise.all([loginAs('cashier'), loginAs('admin')])
})

async function openTabWithItem(customerId: string | null, price = 100) {
    const product = await createProduct({ selling_price: price, tax_rate: 0, stock: 20 })
    const opened = await cashier.rpc('open_tab', {
        p_label: uniq('Recv'),
        p_customer_id: (customerId ?? null) as string,
        p_members: []
    })
    if (opened.error) throw opened.error
    const tabId = opened.data as string
    const added = await cashier.rpc('tab_add_items', {
        p_tab_id: tabId,
        p_items: [{ product_id: product.id, quantity: 1 }]
    })
    if (added.error) throw added.error
    return { tabId, total: price }
}

async function todayInStoreTz(): Promise<string> {
    const zoneRow = await service().from('settings').select('value').eq('key', 'timezone').single()
    if (zoneRow.error) throw zoneRow.error
    const zone = typeof zoneRow.data.value === 'string' ? zoneRow.data.value : 'UTC'
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date())
}

describe('receivables', () => {
    test('defer without customer → P0001; cashier may defer with a customer', async () => {
        const noCustomer = await openTabWithItem(null)
        const denied = await rpc(cashier, 'defer_tab', {
            p_tab_id: noCustomer.tabId,
            p_due_date: null,
            p_reminder: false,
            p_note: null
        })
        expect(denied.error?.code).toBe('P0001')

        const customer = await createCustomer()
        const withCustomer = await openTabWithItem(customer.id)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: withCustomer.tabId,
            p_due_date: '2099-01-15',
            p_reminder: true,
            p_note: 'call them'
        })
        expect(deferred.error).toBeNull()
        const orderId = deferred.data as string
        const order = await service().from('orders').select('status, settled_at, due_date').eq('id', orderId).single()
        expect(order.error).toBeNull()
        expect(order.data).toMatchObject({ status: 'pending', settled_at: null, due_date: '2099-01-15' })
    })

    test('a deferred order is absent from sales_report until fully paid on the payment day', async () => {
        const customer = await createCustomer()
        const { tabId, total } = await openTabWithItem(customer.id, 50)
        const today = await todayInStoreTz()

        const beforeDefer = await manager.rpc('sales_report', { p_from: today, p_to: today })
        expect(beforeDefer.error).toBeNull()
        const revenueBefore = Number((beforeDefer.data as { total_revenue: number }).total_revenue)

        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: null,
            p_reminder: false,
            p_note: null
        })
        expect(deferred.error).toBeNull()
        const orderId = deferred.data as string

        const afterDefer = await manager.rpc('sales_report', { p_from: today, p_to: today })
        expect(afterDefer.error).toBeNull()
        expect(Number((afterDefer.data as { total_revenue: number }).total_revenue)).toBe(revenueBefore)

        const paid = await rpc(cashier, 'pay_receivable', {
            p_order_id: orderId,
            p_payments: [{ method: 'cash', amount: total }],
            p_idempotency_key: crypto.randomUUID()
        })
        expect(paid.error).toBeNull()
        expect(paid.data).toMatchObject({ balance: 0, status: 'completed' })

        const afterPay = await manager.rpc('sales_report', { p_from: today, p_to: today })
        expect(afterPay.error).toBeNull()
        expect(Number((afterPay.data as { total_revenue: number }).total_revenue)).toBe(revenueBefore + total)
    })

    test('partial payment leaves the right balance and status pending', async () => {
        const customer = await createCustomer()
        const { tabId, total } = await openTabWithItem(customer.id, 80)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: null,
            p_reminder: false,
            p_note: null
        })
        const orderId = deferred.data as string

        const partial = await rpc(cashier, 'pay_receivable', {
            p_order_id: orderId,
            p_payments: [{ method: 'cash', amount: 30 }],
            p_idempotency_key: crypto.randomUUID()
        })
        expect(partial.error).toBeNull()
        expect(partial.data).toMatchObject({ balance: total - 30, status: 'pending' })
    })

    test('two concurrent pay_receivable for the full balance: one fails (FOR UPDATE)', async () => {
        // Row lock on the order: the second concurrent full payment must see a reduced balance and raise P0001.
        const customer = await createCustomer()
        const { tabId, total } = await openTabWithItem(customer.id, 60)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: null,
            p_reminder: false,
            p_note: null
        })
        const orderId = deferred.data as string

        const [a, b] = await Promise.all([
            rpc(cashier, 'pay_receivable', {
                p_order_id: orderId,
                p_payments: [{ method: 'cash', amount: total }],
                p_idempotency_key: crypto.randomUUID()
            }),
            rpc(cashier, 'pay_receivable', {
                p_order_id: orderId,
                p_payments: [{ method: 'card', amount: total }],
                p_idempotency_key: crypto.randomUUID()
            })
        ])
        const errors = [a.error, b.error].filter(Boolean)
        const oks = [a.data, b.data].filter(Boolean)
        expect(oks).toHaveLength(1)
        expect(errors).toHaveLength(1)
        expect(errors[0]?.code).toBe('P0001')
    })

    test('refund_order on pending → P0001', async () => {
        const customer = await createCustomer()
        const { tabId } = await openTabWithItem(customer.id, 40)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: null,
            p_reminder: false,
            p_note: null
        })
        const orderId = deferred.data as string
        const refunded = await manager.rpc('refund_order', { p_order_id: orderId, p_reason: 'too soon' })
        expect(refunded.error?.code).toBe('P0001')
    })

    test('cashier write_off → 42501', async () => {
        const customer = await createCustomer()
        const { tabId } = await openTabWithItem(customer.id, 25)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: null,
            p_reminder: false,
            p_note: null
        })
        const orderId = deferred.data as string

        const viaRpc = await rpc(cashier, 'write_off_receivable', {
            p_order_id: orderId,
            p_reason: 'bad debt'
        })
        expect(viaRpc.error?.code).toBe('42501')

        const viaHttp = await cashierHttp.post(writeOffRoute, `receivables/${orderId}/write-off`, {
            params: { id: orderId },
            body: { reason: 'bad debt' }
        })
        expect(viaHttp.status).toBe(403)

        const ok = await adminHttp.post(writeOffRoute, `receivables/${orderId}/write-off`, {
            params: { id: orderId },
            body: { reason: 'bad debt' }
        })
        expect(ok.status).toBe(204)
    })

    // C1 (M5): see docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md
    test('C1: net_profit deducts only the cost of a written-off order, and a later collected payment counts as revenue', async () => {
        const customer = await createCustomer()
        // cost_price defaults to 0 on createProduct unless set; use an explicit cost so COGS is non-zero and checkable.
        const product = await service()
            .from('products')
            .insert({ name: uniq('C1'), sku: uniq('SKU'), selling_price: 100, cost_price: 40, tax_rate: 0 })
            .select('id')
            .single()
        expect(product.error).toBeNull()
        await service().from('inventory').update({ quantity: 5 }).eq('product_id', product.data!.id)

        const opened = await cashier.rpc('open_tab', {
            p_label: uniq('C1'),
            p_customer_id: customer.id,
            p_members: []
        })
        expect(opened.error).toBeNull()
        const tabId = opened.data as string
        expect(
            (
                await cashier.rpc('tab_add_items', {
                    p_tab_id: tabId,
                    p_items: [{ product_id: product.data!.id, quantity: 1 }]
                })
            ).error
        ).toBeNull()
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: null,
            p_reminder: false,
            p_note: null
        })
        expect(deferred.error).toBeNull()
        const orderId = deferred.data as string

        const today = await todayInStoreTz()
        const before = await manager.rpc('sales_report', {
            p_from: today,
            p_to: today,
            p_tz: null as unknown as string
        })
        expect(before.error).toBeNull()
        const baseline = before.data as { written_off_total: number; net_profit: number; total_revenue: number }

        // Collect a partial payment BEFORE writing off: this must count as revenue on today's report.
        const partial = await rpc(cashier, 'pay_receivable', {
            p_order_id: orderId,
            p_payments: [{ method: 'cash', amount: 30 }]
        })
        expect(partial.error).toBeNull()

        const written = await adminHttp.post(writeOffRoute, `receivables/${orderId}/write-off`, {
            params: { id: orderId },
            body: { reason: 'C1 test' }
        })
        expect(written.status).toBe(204)

        const after = await manager.rpc('sales_report', { p_from: today, p_to: today, p_tz: null as unknown as string })
        expect(after.error).toBeNull()
        const data = after.data as { written_off_total: number; net_profit: number; total_revenue: number }

        // Balance left uncollected: 100 - 30 = 70, shown for visibility only (not subtracted from net_profit).
        expect(data.written_off_total - baseline.written_off_total).toBe(70)
        // The 30 already collected is counted as revenue, same as any other sale.
        expect(data.total_revenue - baseline.total_revenue).toBe(30)
        // net_profit contribution = payments collected (30) - full cost of goods (40) = -10. The old formula
        // (subtract the whole uncollected balance, 70, from net_profit with no matching COGS charge) would have
        // shown -70 here instead.
        expect(data.net_profit - baseline.net_profit).toBe(-10)
    })
})

describe('defer_tab v2', () => {
    test('debtor_name without a customer creates a pending order', async () => {
        const { tabId } = await openTabWithItem(null, 40)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null,
            p_customer_id: null,
            p_debtor_name: 'Juan Pérez',
            p_payments: null
        })
        expect(deferred.error).toBeNull()
        const order = await service()
            .from('orders')
            .select('status, debtor_name, customer_id')
            .eq('id', deferred.data as string)
            .single()
        expect(order.data).toMatchObject({
            status: 'pending',
            debtor_name: 'Juan Pérez',
            customer_id: null
        })
    })

    test('no customer and no name → P0001', async () => {
        const { tabId } = await openTabWithItem(null)
        const denied = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null
        })
        expect(denied.error?.code).toBe('P0001')
    })

    test('inactive or soft-deleted customer → P0001', async () => {
        const inactive = await createCustomer({ is_active: false })
        const { tabId: inactiveTab } = await openTabWithItem(null, 20)
        const inactiveDenied = await rpc(cashier, 'defer_tab', {
            p_tab_id: inactiveTab,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null,
            p_customer_id: inactive.id
        })
        expect(inactiveDenied.error?.code).toBe('P0001')

        const deleted = await createCustomer({ deleted_at: new Date().toISOString() })
        const { tabId: deletedTab } = await openTabWithItem(null, 20)
        const deletedDenied = await rpc(cashier, 'defer_tab', {
            p_tab_id: deletedTab,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null,
            p_customer_id: deleted.id
        })
        expect(deletedDenied.error?.code).toBe('P0001')
    })

    test('initial split payment copies methods and cash_session_id onto the order', async () => {
        const users = await ensureTestUsers()
        const register = await service().from('cash_registers').select('id').eq('name', 'Caja 1').single()
        if (register.error) throw register.error
        await service()
            .from('cash_sessions')
            .update({ status: 'closed', closed_at: new Date().toISOString() })
            .eq('status', 'open')
        await service()
            .from('business_days')
            .update({ closed_at: new Date().toISOString(), close_kind: 'manual' })
            .is('closed_at', null)
        expect((await cashier.rpc('open_business_day', {})).error).toBeNull()
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: register.data.id,
            p_opening_float: 0,
            p_user_ids: [users.cashier.id]
        })
        expect(session.error).toBeNull()

        const { tabId, total } = await openTabWithItem(null, 100)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null,
            p_debtor_name: 'Split debtor',
            p_payments: [
                { method: 'cash', amount: 30 },
                { method: 'card', amount: 20 }
            ]
        })
        expect(deferred.error).toBeNull()
        const orderId = deferred.data as string
        const payments = await service()
            .from('payments')
            .select('payment_method, amount, cash_session_id')
            .eq('order_id', orderId)
            .order('payment_method')
        expect(payments.error).toBeNull()
        expect(payments.data).toHaveLength(2)
        expect(payments.data).toEqual(
            expect.arrayContaining([
                { payment_method: 'card', amount: 20, cash_session_id: session.data },
                { payment_method: 'cash', amount: 30, cash_session_id: session.data }
            ])
        )
        const listed = await rpc(cashier, 'list_receivables', {
            p_status: 'pending',
            p_customer_id: null,
            p_q: 'Split debtor'
        })
        expect(listed.error).toBeNull()
        const row = (listed.data as Array<{ order_id: string; balance: number; debtor_name: string | null }>).find(
            item => item.order_id === orderId
        )
        expect(row).toMatchObject({ balance: total - 50, debtor_name: 'Split debtor' })
    })

    test('an abono >= balance → P0001', async () => {
        const { tabId, total } = await openTabWithItem(null, 50)
        const denied = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null,
            p_debtor_name: 'Too much',
            p_payments: [{ method: 'cash', amount: total }]
        })
        expect(denied.error?.code).toBe('P0001')
    })

    test('a past due date → P0001', async () => {
        const { tabId } = await openTabWithItem(null, 25)
        const denied = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: '2000-01-01',
            p_reminder: false,
            p_note: null,
            p_debtor_name: 'Late date'
        })
        expect(denied.error?.code).toBe('P0001')
    })

    test('retrying the same idempotency key does not create a second order', async () => {
        const { tabId } = await openTabWithItem(null, 35)
        const key = crypto.randomUUID()
        const args = {
            p_tab_id: tabId,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null,
            p_debtor_name: 'Idempotent',
            p_idempotency_key: key
        }
        const first = await rpc(cashier, 'defer_tab', args)
        expect(first.error).toBeNull()
        const second = await rpc(cashier, 'defer_tab', args)
        expect(second.error).toBeNull()
        expect(second.data).toBe(first.data)
        const orders = await service()
            .from('orders')
            .select('id')
            .eq('id', first.data as string)
        expect(orders.data).toHaveLength(1)
        const tabs = await service().from('tabs').select('id').eq('id', tabId).eq('status', 'closed')
        expect(tabs.data).toHaveLength(1)
    })

    test('list_receivables p_q matches a debtor name', async () => {
        const needle = uniq('Qdebtor')
        const { tabId } = await openTabWithItem(null, 15)
        const deferred = await rpc(cashier, 'defer_tab', {
            p_tab_id: tabId,
            p_due_date: '2099-01-15',
            p_reminder: false,
            p_note: null,
            p_debtor_name: needle
        })
        expect(deferred.error).toBeNull()
        const listed = await rpc(cashier, 'list_receivables', {
            p_status: 'pending',
            p_customer_id: null,
            p_q: needle.slice(0, 8)
        })
        expect(listed.error).toBeNull()
        const rows = listed.data as Array<{ debtor_name: string | null; customer_name: string | null }>
        expect(rows.some(row => row.debtor_name === needle && row.customer_name === needle)).toBe(true)
    })
})
