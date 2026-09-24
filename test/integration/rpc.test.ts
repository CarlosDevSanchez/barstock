import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
    adminClient,
    createCustomer,
    createProduct,
    ensureTestUsers,
    pinStoreCurrency,
    signedInClient,
    stockOf,
    type Db
} from '../helpers/integration'

let cashier: Db
let manager: Db
const service = () => adminClient()
const walkIn = null as unknown as string // the generated type says `string`; the function accepts NULL

let restoreCurrency: () => Promise<void>

beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD') // these suites assert cents; COP (whole pesos) has its own suite
    ;[cashier, manager] = await Promise.all([signedInClient('cashier'), signedInClient('manager')])
})
afterAll(async () => {
    await restoreCurrency()
})

type Line = { product_id: string; variant_id?: string | null; quantity: number; discount?: number }
const sell = (
    db: Db,
    items: Line[],
    extra: { customer?: string | null; discount?: number; method?: 'cash' | 'card' | 'ewallet' } = {}
) =>
    db.rpc('create_sale', {
        p_customer_id: (extra.customer ?? walkIn) as string,
        p_items: items,
        p_payment_method: extra.method ?? 'cash',
        p_discount: extra.discount ?? 0
    })

const movements = async (productId: string, type: string) => {
    const { data: inventory } = await service()
        .from('inventory')
        .select('id')
        .eq('product_id', productId)
        .is('variant_id', null)
        .single()
    const { data } = await service()
        .from('inventory_transactions')
        .select('quantity')
        .eq('inventory_id', inventory?.id ?? '')
        .eq('transaction_type', type)
    return data ?? []
}

describe('create_sale', () => {
    test('the order keeps the price it was sold at, whatever happens to the product afterwards', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0.1, stock: 5 })
        const orderId = (await sell(cashier, [{ product_id: product.id, quantity: 1 }])).data ?? ''
        await service().from('products').update({ selling_price: 99, tax_rate: 0 }).eq('id', product.id)
        const { data } = await service()
            .from('order_items')
            .select('unit_price, tax, total')
            .eq('order_id', orderId)
            .single()
        expect(data).toEqual({ unit_price: 10, tax: 1, total: 11 })
    })

    test('a variant must belong to the product being sold', async () => {
        const a = await createProduct({ stock: 5 })
        const b = await createProduct({ stock: 5 })
        const { data: variant } = await service()
            .from('product_variants')
            .insert({ product_id: a.id, name: 'L', variant_type: 'size', sku: `${a.sku}-L` })
            .select('id')
            .single()
        const response = await sell(cashier, [{ product_id: b.id, variant_id: variant?.id, quantity: 1 }])
        expect(response.error?.message).toBe('Product not available')
        expect(await stockOf(b.id)).toBe(5)
    })

    test('every sold line leaves a stock movement tied to the order', async () => {
        const a = await createProduct({ stock: 5 })
        const b = await createProduct({ stock: 5 })
        const orderId =
            (
                await sell(cashier, [
                    { product_id: a.id, quantity: 2 },
                    { product_id: b.id, quantity: 3 }
                ])
            ).data ?? ''
        expect(await movements(a.id, 'sale')).toEqual([{ quantity: -2 }])
        expect(await movements(b.id, 'sale')).toEqual([{ quantity: -3 }])
        const { data } = await service()
            .from('inventory_transactions')
            .select('reference_id')
            .eq('reference_id', orderId)
        expect(data).toHaveLength(2)
    })

    test('the same product on two lines is summed against the stock, not checked line by line', async () => {
        const product = await createProduct({ stock: 3 })
        const response = await sell(cashier, [
            { product_id: product.id, quantity: 2 },
            { product_id: product.id, quantity: 2 }
        ])
        expect(response.error?.message).toMatch(/^Insufficient stock/)
        expect(await stockOf(product.id)).toBe(3)
    })

    test('rejects invalid discounts and quantities without side effects', async () => {
        const product = await createProduct({ stock: 5, selling_price: 10 })
        const items = [{ product_id: product.id, quantity: 1 }]
        expect((await sell(cashier, items, { discount: -1 })).error?.message).toBe('Invalid discount')
        expect((await sell(cashier, items, { discount: 0.001 })).error?.message).toBe('Invalid discount')
        expect((await sell(cashier, [{ product_id: product.id, quantity: 1, discount: 999 }])).error?.message).toMatch(
            /exceeds/
        )
        expect((await sell(cashier, [{ product_id: product.id, quantity: -2 }])).error?.message).toBe(
            'Invalid quantity'
        )
        expect((await sell(cashier, [])).error?.message).toBe('The cart is empty')
        expect(await stockOf(product.id)).toBe(5)
    })

    test('payment is recorded for the full total in the chosen method', async () => {
        const product = await createProduct({ selling_price: 12.5, tax_rate: 0, stock: 5 })
        const orderId =
            (await sell(cashier, [{ product_id: product.id, quantity: 2 }], { method: 'ewallet', discount: 5 })).data ??
            ''
        const { data } = await service()
            .from('payments')
            .select('payment_method, amount')
            .eq('order_id', orderId)
            .single()
        expect(data).toEqual({ payment_method: 'ewallet', amount: 20 })
    })
})

describe('concurrency', () => {
    test('two sales of the last unit: exactly one wins, the other is told there is no stock', async () => {
        const product = await createProduct({ stock: 1 })
        const results = await Promise.all([
            sell(cashier, [{ product_id: product.id, quantity: 1 }]),
            sell(manager, [{ product_id: product.id, quantity: 1 }])
        ])
        const winners = results.filter(result => result.data)
        const losers = results.filter(result => result.error)
        expect(winners).toHaveLength(1)
        expect(losers).toHaveLength(1)
        expect(losers[0]?.error?.message).toMatch(/^Insufficient stock for "/)
        expect(await stockOf(product.id)).toBe(0)
        expect(await movements(product.id, 'sale')).toHaveLength(1)
    })

    test('a burst of 25 single-unit sales against 7 units in stock sells exactly 7', async () => {
        const product = await createProduct({ stock: 7 })
        const clients = [cashier, manager]
        const results = await Promise.all(
            Array.from({ length: 25 }, (_, index) =>
                sell(clients[index % 2] as Db, [{ product_id: product.id, quantity: 1 }])
            )
        )
        expect(results.filter(result => result.data)).toHaveLength(7)
        expect(
            results
                .filter(result => result.error)
                .every(result => /^Insufficient stock/.test(result.error?.message ?? ''))
        ).toBe(true)
        expect(await stockOf(product.id)).toBe(0) // never negative
        expect(await movements(product.id, 'sale')).toHaveLength(7)
        const { count } = await service()
            .from('order_items')
            .select('*', { count: 'exact', head: true })
            .eq('product_id', product.id)
        expect(count).toBe(7)
    })

    test('sales listing the same two products in opposite order never deadlock', async () => {
        const a = await createProduct({ stock: 100 })
        const b = await createProduct({ stock: 100 })
        const results = await Promise.all(
            Array.from({ length: 24 }, (_, index) =>
                sell(
                    index % 2 ? cashier : manager,
                    index % 3
                        ? [
                              { product_id: a.id, quantity: 1 },
                              { product_id: b.id, quantity: 1 }
                          ]
                        : [
                              { product_id: b.id, quantity: 1 },
                              { product_id: a.id, quantity: 1 }
                          ]
                )
            )
        )
        expect(results.filter(result => result.error).map(result => result.error?.message)).toEqual([])
        expect(await stockOf(a.id)).toBe(76)
        expect(await stockOf(b.id)).toBe(76)
    })

    // The window between "read the status" and "write it" is microseconds wide, so a single burst rarely hits it: many rounds
    // make a missing row lock (FOR UPDATE) fail this test reliably (checked by removing the lock on purpose).
    test('simultaneous refunds of the same order restore the stock exactly once (30 rounds x 8 parallel)', async () => {
        const doubled: string[] = []
        for (let round = 0; round < 30; round++) {
            const product = await createProduct({ stock: 5 })
            const orderId = (await sell(cashier, [{ product_id: product.id, quantity: 3 }])).data ?? ''
            const results = await Promise.all(
                Array.from({ length: 8 }, () =>
                    manager.rpc('refund_order', { p_order_id: orderId, p_reason: 'race condition test' })
                )
            )
            expect(results.filter(result => result.error)).toEqual([])
            if ((await stockOf(product.id)) !== 5 || (await movements(product.id, 'return')).length !== 1)
                doubled.push(orderId)
        }
        expect(doubled).toEqual([])
    })

    test('a refund racing with sales of the same product keeps the arithmetic exact', async () => {
        const product = await createProduct({ stock: 4 })
        const first = (await sell(cashier, [{ product_id: product.id, quantity: 4 }])).data ?? ''
        const [refund, ...sales] = await Promise.all([
            manager.rpc('refund_order', { p_order_id: first, p_reason: 'racing' }),
            ...Array.from({ length: 6 }, () => sell(cashier, [{ product_id: product.id, quantity: 1 }]))
        ])
        expect(refund.error).toBeNull()
        const sold = sales.filter(sale => sale.data).length
        expect(await stockOf(product.id)).toBe(4 - sold) // 0 + 4 restored - what the racers bought
    })

    test('concurrent stock adjustments cannot push the stock below zero', async () => {
        const product = await createProduct({ stock: 5 })
        const { data: inventory } = await service().from('inventory').select('id').eq('product_id', product.id).single()
        const results = await Promise.all(
            Array.from({ length: 6 }, () =>
                manager.rpc('adjust_inventory', {
                    p_inventory_id: inventory?.id ?? '',
                    p_delta: -2,
                    p_reason: 'shrinkage'
                })
            )
        )
        expect(results.filter(result => !result.error)).toHaveLength(2) // 5 -> 3 -> 1; the rest would go negative
        expect(await stockOf(product.id)).toBe(1)
    })
})

describe('refund_order', () => {
    test('only completed orders can be refunded, and each line is restocked with a "return" movement', async () => {
        const a = await createProduct({ stock: 5 })
        const b = await createProduct({ stock: 5 })
        const orderId =
            (
                await sell(cashier, [
                    { product_id: a.id, quantity: 2 },
                    { product_id: b.id, quantity: 1 }
                ])
            ).data ?? ''
        const done = await manager.rpc('refund_order', { p_order_id: orderId, p_reason: 'defective' })
        expect(done.error).toBeNull()
        expect(await stockOf(a.id)).toBe(5)
        expect(await stockOf(b.id)).toBe(5)
        expect(await movements(a.id, 'return')).toEqual([{ quantity: 2 }])
        const { data } = await service()
            .from('orders')
            .select('status, refund_reason, refunded_by, refunded_at')
            .eq('id', orderId)
            .single()
        expect(data?.status).toBe('refunded')
        expect(data?.refund_reason).toBe('defective')
        expect(data?.refunded_by).toBeTruthy()
        expect(data?.refunded_at).toBeTruthy()

        const pending = await service()
            .from('orders')
            .insert({ order_number: `PEND-${crypto.randomUUID().slice(0, 8)}`, status: 'pending' })
            .select('id')
            .single()
        const refusal = await manager.rpc('refund_order', {
            p_order_id: pending.data?.id ?? '',
            p_reason: 'should not work'
        })
        expect(refusal.error?.message).toBe('Pending receivables cannot be refunded')
        expect(refusal.error?.code).toBe('P0001')
    })

    test('a reason is mandatory and an unknown order is reported as not found', async () => {
        const product = await createProduct({ stock: 2 })
        const orderId = (await sell(cashier, [{ product_id: product.id, quantity: 1 }])).data ?? ''
        expect((await manager.rpc('refund_order', { p_order_id: orderId, p_reason: '  ' })).error?.message).toBe(
            'A reason is required'
        )
        expect(
            (await manager.rpc('refund_order', { p_order_id: crypto.randomUUID(), p_reason: 'ghost order' })).error
                ?.code
        ).toBe('P0002')
        expect(await stockOf(product.id)).toBe(1)
    })

    test('customer spending follows the order status', async () => {
        const customer = await createCustomer()
        const product = await createProduct({ selling_price: 30, tax_rate: 0, stock: 5 })
        const one =
            (await sell(cashier, [{ product_id: product.id, quantity: 1 }], { customer: customer.id })).data ?? ''
        await sell(cashier, [{ product_id: product.id, quantity: 2 }], { customer: customer.id })
        expect(
            (await service().from('customers').select('total_spent, loyalty_points').eq('id', customer.id).single())
                .data
        ).toEqual({ total_spent: 90, loyalty_points: 90 })
        await manager.rpc('refund_order', { p_order_id: one, p_reason: 'returned one' })
        expect(
            (await service().from('customers').select('total_spent, loyalty_points').eq('id', customer.id).single())
                .data
        ).toEqual({ total_spent: 60, loyalty_points: 60 })
    })
})

describe('adjust_inventory', () => {
    test('needs manager rights, a real change and a reason', async () => {
        const product = await createProduct({ stock: 5 })
        const { data: inventory } = await service().from('inventory').select('id').eq('product_id', product.id).single()
        const id = inventory?.id ?? ''
        expect(
            (await cashier.rpc('adjust_inventory', { p_inventory_id: id, p_delta: 1, p_reason: 'nope nope' })).error
                ?.code
        ).toBe('42501')
        expect(
            (await manager.rpc('adjust_inventory', { p_inventory_id: id, p_delta: 0, p_reason: 'nothing' })).error
                ?.message
        ).toBe('The adjustment must not be zero')
        expect(
            (await manager.rpc('adjust_inventory', { p_inventory_id: id, p_delta: 1, p_reason: '' })).error?.message
        ).toBe('A reason is required')
        const ok = await manager.rpc('adjust_inventory', { p_inventory_id: id, p_delta: 4, p_reason: 'Recount' })
        expect(ok.data).toBe(9)
        const { data } = await service().from('inventory').select('last_restocked_at').eq('id', id).single()
        expect(data?.last_restocked_at).not.toBeNull()
        expect(await movements(product.id, 'adjustment')).toEqual([{ quantity: 4 }])
    })
})

describe('reporting functions', () => {
    test('validate their arguments', async () => {
        expect((await manager.rpc('sales_report', { p_from: '2026-02-01', p_to: '2026-01-01' })).error?.message).toBe(
            'Invalid date range'
        )
        expect((await manager.rpc('sales_report', { p_from: '2020-01-01', p_to: '2026-01-01' })).error?.message).toBe(
            'The range cannot exceed 366 days'
        )
        expect((await cashier.rpc('sales_report', { p_from: '2026-01-01', p_to: '2026-01-02' })).error?.code).toBe(
            '42501'
        )
    })

    test('days are bucketed in the requested time zone', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        await sell(manager, [{ product_id: product.id, quantity: 1 }])
        const zones = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'] // UTC+14 and UTC-11: always on different calendar days
        const dates = await Promise.all(
            zones.map(async tz => {
                const { data } = await manager.rpc('dashboard_summary', { p_tz: tz })
                const days = (data as { sales_last_7_days: Array<{ date: string }> }).sales_last_7_days
                return days.at(-1)?.date
            })
        )
        expect(dates[0]).not.toBe(dates[1])
        expect(dates[0] && dates[1] && dates[0] > dates[1]).toBe(true)
    })
})
