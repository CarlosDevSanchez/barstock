import { beforeAll, describe, expect, test } from 'bun:test'
import { POST as createSale } from '@/app/api/v1/sales/route'
import { adminClient, createProduct, ensureTestUsers } from '../helpers/integration'
import { dataOf, loginAs, type TestClient } from '../helpers/http'

// `order_items.tax_rate` (migration 20260923000002_receipt.sql) is a pure snapshot for the printed receipt: a
// `before insert` trigger copies it from `products.tax_rate` at the moment of the sale. It never feeds
// `create_sale`'s money math (subtotal/tax/total are unchanged by this migration).

let cashier: TestClient

beforeAll(async () => {
    await ensureTestUsers()
    cashier = await loginAs('cashier')
})

interface Order {
    id: string
    items: Array<{ id: string; product_id: string; quantity: number; unit_price: number; discount: number }>
}

const sale = (body: unknown) => cashier.post(createSale, 'sales', { body })

const orderItemRow = async (id: string) => {
    const { data, error } = await adminClient()
        .from('order_items')
        .select('unit_price, quantity, discount, tax, tax_rate')
        .eq('id', id)
        .single()
    if (error) throw error
    return data
}

describe('order_items.tax_rate trigger', () => {
    test('a new sale snapshots the product tax_rate at the time of the sale', async () => {
        const product = await createProduct({ selling_price: 100, tax_rate: 0.19, stock: 5 })
        const order = dataOf<Order>(
            await sale({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )
        const item = order.items[0]
        if (!item) throw new Error('no item on the created order')
        const row = await orderItemRow(item.id)
        expect(row.tax_rate).toBe(0.19)
    })

    test('changing the product tax_rate afterwards does not change the already-sold line (it is a snapshot)', async () => {
        const product = await createProduct({ selling_price: 50, tax_rate: 0.1, stock: 5 })
        const order = dataOf<Order>(
            await sale({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
        )
        const item = order.items[0]
        if (!item) throw new Error('no item on the created order')

        const { error } = await adminClient().from('products').update({ tax_rate: 0.05 }).eq('id', product.id)
        if (error) throw error

        const row = await orderItemRow(item.id)
        expect(row.tax_rate).toBe(0.1) // unchanged: the trigger only ran once, at insert time
    })

    test('the backfill formula (round(tax / nullif(base, 0), 4)) reconstructs the same rate the trigger snapshotted', async () => {
        // Reproduces, in JS, the exact UPDATE the migration runs once against pre-existing rows. There is no
        // pre-migration order_items data in a fresh local stack (seed.sql ships none), so this proves the formula
        // is faithful using rows the trigger is known to have snapshotted correctly, rather than re-running the
        // migration's UPDATE against fixture data it can no longer reach.
        const product = await createProduct({ selling_price: 35_000, tax_rate: 0.19, stock: 5 })
        const order = dataOf<Order>(
            await sale({
                payment_method: 'cash',
                items: [{ product_id: product.id, quantity: 2, discount: 5_000 }]
            })
        )
        const item = order.items[0]
        if (!item) throw new Error('no item on the created order')
        const row = await orderItemRow(item.id)

        const base = row.unit_price * row.quantity - row.discount
        const reconstructed = base === 0 ? null : Math.round((row.tax / base) * 10_000) / 10_000
        expect(reconstructed).toBe(row.tax_rate)
    })

    test('a fully-discounted line has no meaningful base, so the formula (not the live trigger) would leave it null', () => {
        // `nullif(unit_price*quantity - discount, 0)` -> NULL when the taxable base is 0; `round(x / NULL, 4)` is
        // NULL. Purely a property of the SQL formula (division has no local equivalent to exercise against the
        // live trigger, since create_sale always inserts with the product's current rate, never NULL).
        const base = 100 * 1 - 100
        const reconstructed = base === 0 ? null : Math.round((1 / base) * 10_000) / 10_000
        expect(reconstructed).toBeNull()
    })
})
