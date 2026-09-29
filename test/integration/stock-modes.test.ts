import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { TablesUpdate } from '@/types/database'
import { POST as createSale } from '@/app/api/v1/sales/route'
import { POST as refundOrder } from '@/app/api/v1/orders/[id]/refund/route'
import { POST as openTab } from '@/app/api/v1/tabs/route'
import { POST as addTabItems } from '@/app/api/v1/tabs/[id]/items/route'
import { DELETE as removeTabItem } from '@/app/api/v1/tabs/[id]/items/[itemId]/route'
import { POST as voidTab } from '@/app/api/v1/tabs/[id]/void/route'
import { POST as payTab } from '@/app/api/v1/tabs/[id]/payments/route'
import { POST as receivePurchase } from '@/app/api/v1/purchases/route'
import { GET as listProducts, POST as createProductRoute } from '@/app/api/v1/products/route'
import { GET as topProducts } from '@/app/api/v1/products/top/route'
import { GET as posSnapshot } from '@/app/api/v1/pos/snapshot/route'
import { GET as listInventory } from '@/app/api/v1/inventory/route'
import { GET as dashboard } from '@/app/api/v1/dashboard/route'
import { GET as listPromotions } from '@/app/api/v1/promotions/route'
import {
    adminClient,
    createProduct,
    createSupplier,
    ensureTestUsers,
    pinStoreCurrency,
    signedInClient,
    stockOf,
    uniq
} from '../helpers/integration'
import { dataOf, errorOf, loginAs, type TestClient } from '../helpers/http'

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

interface OrderLine {
    product_id: string
    quantity: number
    stock_taken: number | null
    stock_product_id: string | null
    stock_units: number | null
    unit_cost: number | null
}

/** A single cigarette (base, 2 each) and a box of 15 (10) that sells from the same stock. */
async function cigarettes(stock: number) {
    const single = await createProduct({ name: uniq('Cigarette'), selling_price: 2, cost_price: 1, tax_rate: 0, stock })
    const box = await createProduct({
        name: uniq('Box x15'),
        selling_price: 10,
        cost_price: 15,
        tax_rate: 0,
        stock_mode: 'linked',
        stock_product_id: single.id,
        stock_units: 15
    })
    return { single, box }
}

const sell = (items: Array<{ product_id: string; quantity: number }>, extra: Record<string, unknown> = {}) =>
    cashier.post(createSale, 'sales', { body: { items, payment_method: 'cash', ...extra } })

async function linesOf(orderId: string): Promise<OrderLine[]> {
    const { data, error } = await adminClient()
        .from('order_items')
        .select('product_id, quantity, stock_taken, stock_product_id, stock_units, unit_cost')
        .eq('order_id', orderId)
    if (error) throw error
    return data as OrderLine[]
}

const refund = (orderId: string) =>
    manager.post(refundOrder, `orders/${orderId}/refund`, { params: { id: orderId }, body: { reason: 'returned' } })

describe('untracked products (stock_mode = none)', () => {
    test('sell with zero stock and never touch inventory, even on refund', async () => {
        const coffee = await createProduct({ selling_price: 3, tax_rate: 0, stock: 0, stock_mode: 'none' })

        const response = await sell([{ product_id: coffee.id, quantity: 5 }])
        expect(response.status).toBe(201)
        const order = dataOf<{ id: string; total: number }>(response)
        expect(order.total).toBe(15)
        expect(await stockOf(coffee.id)).toBe(0)
        expect(await linesOf(order.id)).toMatchObject([{ stock_units: 0, stock_taken: 0, stock_product_id: null }])

        expect((await refund(order.id)).status).toBe(200)
        expect(await stockOf(coffee.id)).toBe(0)
    })

    test('a purchase of an untracked product is rejected', async () => {
        const coffee = await createProduct({ stock_mode: 'none' })
        const supplier = await createSupplier()
        const response = await manager.post(receivePurchase, 'purchases', {
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: {
                supplier_id: supplier.id,
                items: [{ product_id: coffee.id, quantity: 1, unit_cost: 1 }],
                invoice_number: null,
                notes: null,
                cash_session_id: null
            }
        })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toContain('does not track stock')
    })
})

describe('presentations (stock_mode = linked)', () => {
    test('a box and loose singles in one sale take 15 + n units from the base, each at its own price', async () => {
        const { single, box } = await cigarettes(30)

        const response = await sell([
            { product_id: box.id, quantity: 1 },
            { product_id: single.id, quantity: 3 }
        ])
        expect(response.status).toBe(201)
        const order = dataOf<{ id: string; total: number }>(response)
        expect(order.total).toBe(16)
        expect(await stockOf(single.id)).toBe(12)
        expect(await stockOf(box.id)).toBe(0)

        const lines = await linesOf(order.id)
        expect(lines.find(line => line.product_id === box.id)).toMatchObject({
            stock_product_id: single.id,
            stock_units: 15,
            stock_taken: 15,
            unit_cost: 15
        })
        expect(lines.find(line => line.product_id === single.id)).toMatchObject({
            stock_product_id: single.id,
            stock_units: 1,
            stock_taken: 3
        })
    })

    test('insufficient base stock rejects the whole sale atomically', async () => {
        const { single, box } = await cigarettes(20)

        const response = await sell([
            { product_id: single.id, quantity: 6 },
            { product_id: box.id, quantity: 1 }
        ])
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toContain('Insufficient stock')
        expect(await stockOf(single.id)).toBe(20)
    })

    test('a refund returns the stock to the base recorded at sale time, even if the link changed since', async () => {
        const { single, box } = await cigarettes(30)
        const order = dataOf<{ id: string }>(await sell([{ product_id: box.id, quantity: 2 }]))
        expect(await stockOf(single.id)).toBe(0)

        // The manager later re-packs the presentation as 20 units: the old sale still gives back 30.
        const { error } = await adminClient().from('products').update({ stock_units: 20 }).eq('id', box.id)
        expect(error).toBeNull()

        expect((await refund(order.id)).status).toBe(200)
        expect(await stockOf(single.id)).toBe(30)
    })

    test('an offline sale never fails for stock: it takes what the base has and records the rest', async () => {
        const { single, box } = await cigarettes(7)

        const response = await sell([{ product_id: box.id, quantity: 1 }], {
            occurred_at: new Date(Date.now() - 60_000).toISOString()
        })
        expect(response.status).toBe(201)
        const order = dataOf<{ id: string }>(response)
        expect(await stockOf(single.id)).toBe(0)
        expect(await linesOf(order.id)).toMatchObject([{ stock_taken: 7, stock_units: 15 }])

        const { data, error } = await adminClient().from('orders').select('sync_issues').eq('id', order.id).single()
        if (error) throw error
        expect((data.sync_issues as { stock_shortfall: unknown }).stock_shortfall).toEqual([
            { product_id: single.id, missing: 8 }
        ])

        expect((await refund(order.id)).status).toBe(200)
        expect(await stockOf(single.id)).toBe(7)
    })

    test('tabs: adding takes from the base, removing and voiding give it back', async () => {
        const { single, box } = await cigarettes(40)
        const tab = dataOf<{ id: string }>(await cashier.post(openTab, 'tabs', { body: { label: uniq('Smokes') } }))
        const add = (items: Array<{ product_id: string; quantity: number }>) =>
            cashier.post(addTabItems, `tabs/${tab.id}/items`, { params: { id: tab.id }, body: { items } })

        expect((await add([{ product_id: box.id, quantity: 2 }])).status).toBe(200)
        expect((await add([{ product_id: single.id, quantity: 4 }])).status).toBe(200)
        expect(await stockOf(single.id)).toBe(6)
        expect((await add([{ product_id: box.id, quantity: 1 }])).status).toBe(422)

        const { data: items, error } = await adminClient()
            .from('tab_items')
            .select('id, product_id, stock_product_id, stock_units')
            .eq('tab_id', tab.id)
        if (error) throw error
        const boxLine = items.find(item => item.product_id === box.id)!
        expect(boxLine).toMatchObject({ stock_product_id: single.id, stock_units: 15 })

        const removed = await manager.call(removeTabItem, 'DELETE', `tabs/${tab.id}/items/${boxLine.id}`, {
            params: { id: tab.id, itemId: boxLine.id },
            body: { quantity: 1, reason: 'changed mind' }
        })
        expect(removed.status).toBe(200)
        expect(await stockOf(single.id)).toBe(21)

        const voided = await manager.post(voidTab, `tabs/${tab.id}/void`, {
            params: { id: tab.id },
            body: { reason: 'walked out' }
        })
        expect(voided.status).toBe(200)
        expect(await stockOf(single.id)).toBe(40)
    })

    test('a tab closed into an order keeps the photo, so its refund returns to the base', async () => {
        const { single, box } = await cigarettes(15)
        const tab = dataOf<{ id: string }>(await cashier.post(openTab, 'tabs', { body: { label: uniq('Box') } }))
        await cashier.post(addTabItems, `tabs/${tab.id}/items`, {
            params: { id: tab.id },
            body: { items: [{ product_id: box.id, quantity: 1 }] }
        })
        const closed = dataOf<{ order_id: string }>(
            await cashier.post(payTab, `tabs/${tab.id}/payments`, {
                params: { id: tab.id },
                body: { payment_method: 'cash', amount: 10 }
            })
        )
        expect(await stockOf(single.id)).toBe(0)
        expect(await linesOf(closed.order_id)).toMatchObject([{ stock_product_id: single.id, stock_units: 15 }])

        expect((await refund(closed.order_id)).status).toBe(200)
        expect(await stockOf(single.id)).toBe(15)
    })

    test('buying 2 boxes adds 30 units to the base at the per-unit cost, and voiding takes them back', async () => {
        const { single, box } = await cigarettes(0)
        const supplier = await createSupplier()
        const created = await manager.post(receivePurchase, 'purchases', {
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: {
                supplier_id: supplier.id,
                items: [{ product_id: box.id, quantity: 2, unit_cost: 9 }],
                invoice_number: null,
                notes: null,
                cash_session_id: null
            }
        })
        expect(created.status).toBe(201)
        const purchaseId = dataOf<{ id: string }>(created).id
        expect(await stockOf(single.id)).toBe(30)

        const { data: moves, error } = await adminClient()
            .from('inventory_transactions')
            .select('quantity, unit_cost')
            .eq('reference_id', purchaseId)
        if (error) throw error
        expect(moves).toEqual([{ quantity: 30, unit_cost: 0.6 }])

        const admin = await signedInClient('admin')
        const voided = await admin.rpc('void_purchase', { p_id: purchaseId, p_reason: 'wrong invoice' })
        expect(voided.error).toBeNull()
        expect(await stockOf(single.id)).toBe(0)
    })

    test('a promotion with an untracked and a linked component sells from the right places', async () => {
        const coffee = await createProduct({ selling_price: 3, tax_rate: 0, stock_mode: 'none' })
        const { single, box } = await cigarettes(15)
        const { data: promo, error } = await adminClient()
            .from('promotions')
            .insert({ name: uniq('Coffee + box'), package_price: 12, is_active: true })
            .select()
            .single()
        if (error) throw error
        const items = await adminClient()
            .from('promotion_items')
            .insert([
                { promotion_id: promo.id, product_id: coffee.id, quantity: 1 },
                { promotion_id: promo.id, product_id: box.id, quantity: 1 }
            ])
        expect(items.error).toBeNull()

        const response = await cashier.post(createSale, 'sales', {
            body: { items: [{ promotion_id: promo.id, quantity: 1 }], payment_method: 'cash' }
        })
        expect(response.status).toBe(201)
        expect(await stockOf(single.id)).toBe(0)
    })

    test('concurrent sales of boxes and singles never oversell the shared base', async () => {
        const { single, box } = await cigarettes(20)
        const attempts = await Promise.all([
            sell([{ product_id: box.id, quantity: 1 }]),
            sell([{ product_id: single.id, quantity: 10 }]),
            sell([{ product_id: box.id, quantity: 1 }]),
            sell([{ product_id: single.id, quantity: 5 }])
        ])
        const sold = attempts
            .map((response, index) => (response.status === 201 ? [15, 10, 15, 5][index]! : 0))
            .reduce((a, b) => a + b, 0)
        expect(sold).toBeLessThanOrEqual(20)
        expect(await stockOf(single.id)).toBe(20 - sold)
        expect(attempts.every(response => response.status === 201 || response.status === 422)).toBe(true)
    })
})

describe('products_stock_mode_guard', () => {
    const update = (id: string, values: TablesUpdate<'products'>) =>
        adminClient().from('products').update(values).eq('id', id)

    test('only one level: a presentation cannot be the base of another', async () => {
        const { box } = await cigarettes(0)
        const { error } = await adminClient()
            .from('products')
            .insert({
                name: uniq('Carton'),
                sku: uniq('SKU'),
                selling_price: 1,
                stock_mode: 'linked',
                stock_product_id: box.id,
                stock_units: 10
            })
        expect(error?.message).toContain('must track its own stock')
    })

    test('a base with live presentations cannot stop owning its stock nor be deleted', async () => {
        const { single, box } = await cigarettes(0)
        expect((await update(single.id, { stock_mode: 'none' })).error?.message).toContain('base of other')
        expect((await update(single.id, { deleted_at: new Date().toISOString() })).error?.message).toContain(
            'base of other'
        )

        expect((await update(box.id, { deleted_at: new Date().toISOString(), is_active: false })).error).toBeNull()
        expect((await update(single.id, { stock_mode: 'none' })).error).toBeNull()
    })

    test('a product with stock on hand cannot stop tracking it', async () => {
        const product = await createProduct({ stock: 3 })
        expect((await update(product.id, { stock_mode: 'none' })).error?.message).toContain('Adjust this product')
    })

    test('inconsistent columns are rejected by CHECKs', async () => {
        const product = await createProduct()
        // Linked without a base: the guard trigger (BEFORE) answers first.
        expect((await update(product.id, { stock_mode: 'linked' })).error?.message).toContain('does not exist')
        expect((await update(product.id, { stock_units: 5 })).error?.code).toBe('23514')
    })

    test('a cashier cannot change how a product is tracked (RLS)', async () => {
        const product = await createProduct()
        const db = await signedInClient('cashier')
        const { data } = await db.from('products').update({ stock_mode: 'none' }).eq('id', product.id).select()
        expect(data ?? []).toHaveLength(0)
        const { data: row } = await adminClient().from('products').select('stock_mode').eq('id', product.id).single()
        expect(row?.stock_mode).toBe('own')
    })
})

describe('read APIs show the stock each product sells from', () => {
    interface ListedProduct {
        id: string
        stock_mode: string
        stock: number | null
        stock_base_quantity: number | null
        stock_base: { id: string; name: string } | null
    }

    test('catalog and POS snapshot: whole boxes from the base, no stock for untracked', async () => {
        const { single, box } = await cigarettes(37)
        const coffee = await createProduct({ stock_mode: 'none' })
        const ids = [single.id, box.id, coffee.id].join(',')

        const listed = dataOf<ListedProduct[]>(await cashier.get(listProducts, `products?ids=${ids}`))
        const byId = new Map(listed.map(row => [row.id, row]))
        expect(byId.get(single.id)).toMatchObject({ stock_mode: 'own', stock: 37, stock_base_quantity: 37 })
        expect(byId.get(box.id)).toMatchObject({
            stock_mode: 'linked',
            stock: 2,
            stock_base_quantity: 37,
            stock_base: { id: single.id, name: single.name }
        })
        expect(byId.get(coffee.id)).toMatchObject({ stock_mode: 'none', stock: null, stock_base_quantity: null })

        const snapshot = dataOf<{ products: ListedProduct[] }>(await cashier.get(posSnapshot, 'pos/snapshot'))
        expect(snapshot.products.find(row => row.id === box.id)).toMatchObject({ stock: 2, stock_base_quantity: 37 })

        const bases = dataOf<ListedProduct[]>(await manager.get(listProducts, `products?ids=${ids}&stock_mode=own`))
        expect(bases.map(row => row.id)).toEqual([single.id])
    })

    test('top sellers report the presentation stock from its base', async () => {
        const { single, box } = await cigarettes(40)
        const coffee = await createProduct({ selling_price: 1, tax_rate: 0, stock_mode: 'none' })
        // Enough units to land in the top 20 whatever else the shared test DB has sold.
        await sell([{ product_id: box.id, quantity: 2 }])
        await sell([{ product_id: coffee.id, quantity: 5000 }])
        const top = dataOf<Array<{ product_id: string; stock: number | null; stock_mode: string }>>(
            await cashier.get(topProducts, 'products/top?days=1&limit=20')
        )
        expect(top.find(row => row.product_id === coffee.id)).toMatchObject({ stock_mode: 'none', stock: null })
        expect(await stockOf(single.id)).toBe(10)
    })

    test('inventory lists only rows that own stock, with their presentations; untracked never counts as low', async () => {
        const { single, box } = await cigarettes(37)
        const coffee = await createProduct({ name: uniq('Coffee'), stock_mode: 'none', threshold: 10 })

        const inventory = dataOf<
            Array<{ product: { id: string }; presentations: Array<{ id: string; stock_units: number }> }>
        >(await manager.get(listInventory, `inventory?q=${encodeURIComponent(single.name)}`))
        expect(inventory).toHaveLength(1)
        expect(inventory[0]).toMatchObject({
            product: { id: single.id },
            presentations: [{ id: box.id, stock_units: 15 }]
        })

        const none = dataOf<unknown[]>(
            await manager.get(listInventory, `inventory?q=${encodeURIComponent(coffee.name)}`)
        )
        expect(none).toHaveLength(0)

        const summary = dataOf<{ low_stock_items: Array<{ product_id: string }> }>(
            await manager.get(dashboard, 'dashboard')
        )
        expect(summary.low_stock_items.some(item => item.product_id === coffee.id)).toBe(false)
    })

    test('a promotion of untracked products has no limit; one with a presentation counts whole boxes', async () => {
        const coffee = await createProduct({ selling_price: 3, tax_rate: 0, stock_mode: 'none' })
        const { box } = await cigarettes(31)
        const make = async (items: Array<{ product_id: string; quantity: number }>) => {
            const { data: promo, error } = await adminClient()
                .from('promotions')
                .insert({ name: uniq('Promo'), package_price: 5, is_active: true })
                .select()
                .single()
            if (error) throw error
            const inserted = await adminClient()
                .from('promotion_items')
                .insert(items.map(item => ({ promotion_id: promo.id, ...item })))
            if (inserted.error) throw inserted.error
            return promo.id
        }
        const coffeeOnly = await make([{ product_id: coffee.id, quantity: 2 }])
        const withBox = await make([
            { product_id: coffee.id, quantity: 1 },
            { product_id: box.id, quantity: 1 }
        ])
        const listed = dataOf<Array<{ id: string; available: number | null }>>(
            await cashier.get(listPromotions, `promotions?ids=${coffeeOnly},${withBox}`)
        )
        expect(listed.find(row => row.id === coffeeOnly)?.available).toBeNull()
        expect(listed.find(row => row.id === withBox)?.available).toBe(2)
    })

    test('POST /products validates a presentation and stores the link', async () => {
        const { single } = await cigarettes(0)
        const missingUnits = await manager.post(createProductRoute, 'products', {
            body: {
                name: uniq('Box'),
                sku: uniq('SKU'),
                selling_price: 10,
                stock_mode: 'linked',
                stock_product_id: single.id
            }
        })
        expect(missingUnits.status).toBe(422)

        const created = await manager.post(createProductRoute, 'products', {
            body: {
                name: uniq('Box'),
                sku: uniq('SKU'),
                selling_price: 10,
                stock_mode: 'linked',
                stock_product_id: single.id,
                stock_units: 20
            }
        })
        expect(created.status).toBe(201)
        expect(dataOf<{ stock_product_id: string; stock_units: number }>(created)).toMatchObject({
            stock_product_id: single.id,
            stock_units: 20
        })

        // Only a manager+ writes the catalog, whatever the stock mode.
        const cashierTry = await cashier.post(createProductRoute, 'products', {
            body: { name: uniq('X'), sku: uniq('SKU'), selling_price: 1, stock_mode: 'none' }
        })
        expect(cashierTry.status).toBe(403)
    })
})
