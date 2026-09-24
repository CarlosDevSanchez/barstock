import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
    adminClient,
    createProduct,
    ensureTestUsers,
    pinStoreCurrency,
    signedInClient,
    type Db
} from '../helpers/integration'

let cashier: Db
let manager: Db
const service = () => adminClient()
const walkIn = null as unknown as string

let restoreCurrency: () => Promise<void>

beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
    ;[cashier, manager] = await Promise.all([signedInClient('cashier'), signedInClient('manager')])
})
afterAll(async () => {
    await restoreCurrency()
})

const sell = (
    db: Db,
    items: Array<{ product_id: string; quantity: number }>,
    extra: {
        method?: 'cash' | 'card' | 'ewallet'
        payments?: Array<{ method: 'cash' | 'card' | 'ewallet'; amount: number }>
        occurred_at?: string
        key?: string
    } = {}
) =>
    db.rpc('create_sale', {
        p_customer_id: walkIn,
        p_items: items,
        p_payment_method: (extra.payments ? null : (extra.method ?? 'cash')) as 'cash',
        p_payments: extra.payments ?? null,
        p_discount: 0,
        p_occurred_at: (extra.occurred_at ?? null) as string,
        p_idempotency_key: (extra.key ?? null) as string
    })

describe('set_low_stock_threshold', () => {
    test('a cashier is refused, a negative value is refused, a manager can set it', async () => {
        const product = await createProduct({ stock: 3 })
        const { data: inventory } = await service()
            .from('inventory')
            .select('id')
            .eq('product_id', product.id)
            .is('variant_id', null)
            .single()
        const id = inventory?.id ?? ''

        expect((await cashier.rpc('set_low_stock_threshold', { p_inventory_id: id, p_threshold: 4 })).error?.code).toBe(
            '42501'
        )
        expect(
            (await manager.rpc('set_low_stock_threshold', { p_inventory_id: id, p_threshold: -1 })).error?.code
        ).toBe('P0001')
        expect(
            (await manager.rpc('set_low_stock_threshold', { p_inventory_id: crypto.randomUUID(), p_threshold: 1 }))
                .error?.code
        ).toBe('P0002')

        const saved = await manager.rpc('set_low_stock_threshold', { p_inventory_id: id, p_threshold: 7 })
        expect(saved.error).toBeNull()
        const { data } = await service().from('inventory').select('low_stock_threshold').eq('id', id).single()
        expect(data?.low_stock_threshold).toBe(7)
    })
})

describe('split payments', () => {
    test('two payments that add up are stored; a mismatch is refused; a single method still works', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const split = await sell(cashier, [{ product_id: product.id, quantity: 1 }], {
            payments: [
                { method: 'cash', amount: 4 },
                { method: 'card', amount: 6 }
            ]
        })
        expect(split.error).toBeNull()
        const { data: rows } = await service()
            .from('payments')
            .select('payment_method, amount')
            .eq('order_id', split.data ?? '')
            .order('payment_method')
        expect(rows).toEqual([
            { payment_method: 'cash', amount: 4 },
            { payment_method: 'card', amount: 6 }
        ])

        const mismatch = await sell(cashier, [{ product_id: product.id, quantity: 1 }], {
            payments: [
                { method: 'cash', amount: 4 },
                { method: 'card', amount: 5 }
            ]
        })
        expect(mismatch.error?.message).toBe('Payments do not add up to the total')
        expect(mismatch.error?.code).toBe('P0001')

        const single = await sell(cashier, [{ product_id: product.id, quantity: 1 }], { method: 'ewallet' })
        expect(single.error).toBeNull()
        const { data: one } = await service()
            .from('payments')
            .select('payment_method, amount')
            .eq('order_id', single.data ?? '')
        expect(one).toEqual([{ payment_method: 'ewallet', amount: 10 }])
    })

    test('an offline sale whose payments do not match the server total adjusts the cash line', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const { data: orderId, error } = await sell(cashier, [{ product_id: product.id, quantity: 1 }], {
            payments: [{ method: 'cash', amount: 8 }],
            occurred_at: new Date(Date.now() - 60_000).toISOString()
        })
        expect(error).toBeNull()
        const { data: order } = await service()
            .from('orders')
            .select('sync_issues')
            .eq('id', orderId ?? '')
            .single()
        expect(order?.sync_issues).toMatchObject({ payment_adjusted: { before: 8, after: 10 } })
        const { data: payments } = await service()
            .from('payments')
            .select('amount')
            .eq('order_id', orderId ?? '')
        expect(payments).toEqual([{ amount: 10 }])
    })

    test('the same idempotency key with different payments is a conflict', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const key = crypto.randomUUID()
        const items = [{ product_id: product.id, quantity: 1 }]
        const first = await sell(cashier, items, { payments: [{ method: 'cash', amount: 10 }], key })
        expect(first.error).toBeNull()
        const second = await sell(cashier, items, { payments: [{ method: 'card', amount: 10 }], key })
        expect(second.error?.code).toBe('BS409')
    })

    test('by_payment_method counts distinct orders', async () => {
        const day = new Date().toISOString().slice(0, 10)
        const before = await manager.rpc('sales_report', { p_from: day, p_to: day, p_tz: 'UTC' })
        expect(before.error).toBeNull()
        const cashBefore =
            (before.data as { by_payment_method: Array<{ method: string; orders: number }> }).by_payment_method.find(
                row => row.method === 'cash'
            )?.orders ?? 0

        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const sold = await sell(cashier, [{ product_id: product.id, quantity: 1 }], {
            payments: [
                { method: 'cash', amount: 5 },
                { method: 'cash', amount: 5 }
            ]
        })
        expect(sold.error).toBeNull()

        const after = await manager.rpc('sales_report', { p_from: day, p_to: day, p_tz: 'UTC' })
        const cashAfter =
            (after.data as { by_payment_method: Array<{ method: string; orders: number }> }).by_payment_method.find(
                row => row.method === 'cash'
            )?.orders ?? 0
        expect(cashAfter - cashBefore).toBe(1)
    })
})

describe('tab_pay_split', () => {
    test('a second payment past the balance inserts nothing', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const opened = await cashier.rpc('open_tab', {
            p_label: 'Split',
            p_customer_id: walkIn,
            p_members: []
        })
        expect(opened.error).toBeNull()
        const tabId = opened.data ?? ''
        const added = await cashier.rpc('tab_add_items', {
            p_tab_id: tabId,
            p_items: [{ product_id: product.id, quantity: 1 }]
        })
        expect(added.error).toBeNull()

        const paid = await cashier.rpc('tab_pay_split', {
            p_tab_id: tabId,
            p_member_id: walkIn,
            p_payments: [
                { method: 'cash', amount: 6 },
                { method: 'card', amount: 6 }
            ]
        })
        expect(paid.error?.code).toBe('P0001')
        const { count } = await service()
            .from('tab_payments')
            .select('*', { count: 'exact', head: true })
            .eq('tab_id', tabId)
        expect(count).toBe(0)
    })
})
