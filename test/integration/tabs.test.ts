import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GET as getTab, POST as openTab } from '@/app/api/v1/tabs/route'
import { GET as getTabDetail } from '@/app/api/v1/tabs/[id]/route'
import { POST as addTabItems } from '@/app/api/v1/tabs/[id]/items/route'
import { DELETE as removeTabItem } from '@/app/api/v1/tabs/[id]/items/[itemId]/route'
import { POST as payTab } from '@/app/api/v1/tabs/[id]/payments/route'
import { POST as voidTab } from '@/app/api/v1/tabs/[id]/void/route'
import { GET as getOrder } from '@/app/api/v1/orders/[id]/route'
import { POST as refund } from '@/app/api/v1/orders/[id]/refund/route'
import {
    adminClient,
    createCustomer,
    createProduct,
    ensureTestUsers,
    pinStoreCurrency,
    signedInClient,
    stockOf,
    uniq
} from '../helpers/integration'
import { dataOf, errorOf, loginAs, TestClient } from '../helpers/http'

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

interface Tab {
    id: string
    tab_number: string
    status: 'open' | 'closed' | 'voided'
    order_id: string | null
    members: Array<{ id: string; display_name: string }>
    items: Array<{ id: string; product_id: string; quantity: number; unit_price: number }>
    payments: Array<{ id: string; amount: number; payment_method: string }>
    totals: { subtotal: number; tax: number; discount: number; total: number; paid: number; balance: number }
}
interface Order {
    id: string
    status: string
    total: number
    tab_id: string | null
    items: Array<{ product_id: string; quantity: number }>
    payments: Array<{ amount: number }>
}

const open = (client: TestClient, body: { label: string; customer_id?: string | null; members?: string[] }) =>
    client.post(openTab, 'tabs', { body })
const detail = (client: TestClient, id: string) => client.get(getTabDetail, `tabs/${id}`, { params: { id } })
const addItems = (client: TestClient, id: string, items: Array<{ product_id: string; quantity: number }>) =>
    client.post(addTabItems, `tabs/${id}/items`, { params: { id }, body: { items } })
const removeItem = (client: TestClient, id: string, itemId: string, body: { quantity: number; reason: string }) =>
    client.call(removeTabItem, 'DELETE', `tabs/${id}/items/${itemId}`, { params: { id, itemId }, body })
const pay = (
    client: TestClient,
    id: string,
    body: { member_id?: string | null; payment_method: string; amount: number }
) => client.post(payTab, `tabs/${id}/payments`, { params: { id }, body })
const voidIt = (client: TestClient, id: string, reason: string) =>
    client.post(voidTab, `tabs/${id}/void`, { params: { id }, body: { reason } })

describe('POST /tabs (open_tab)', () => {
    test('needs a session, and a label', async () => {
        expect((await new TestClient().post(openTab, 'tabs', { body: { label: 'x' } })).status).toBe(401)
        expect((await cashier.post(openTab, 'tabs', { body: { label: '' } })).status).toBe(422)
    })

    test('opens with members and lists it as open', async () => {
        const response = await open(cashier, { label: uniq('Table'), members: ['Jhon', 'Carlos'] })
        expect(response.status).toBe(201)
        const tab = dataOf<Tab>(response)
        expect(tab.status).toBe('open')
        expect(tab.tab_number).toMatch(/^TAB-\d{6}$/)
        expect(tab.members.map(m => m.display_name)).toEqual(['Jhon', 'Carlos'])

        const list = (await cashier.get(getTab, 'tabs?status=open')).json<{ data: Array<{ id: string }> }>()
        expect(list.data.some(row => row.id === tab.id)).toBe(true)
    })

    test('rejects a soft-deleted customer the same way it rejects an inactive one', async () => {
        const customer = await createCustomer()
        await adminClient().from('customers').update({ deleted_at: new Date().toISOString() }).eq('id', customer.id)

        const response = await open(cashier, { label: uniq('Table'), customer_id: customer.id })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toBe('Customer not available')
    })
})

describe('adding items decrements stock; removing (manager+) returns it', () => {
    test('a cashier adds items and stock drops; a cashier cannot remove; a manager can, and stock returns', async () => {
        const product = await createProduct({ selling_price: 5, tax_rate: 0.1, stock: 10 })
        const tab = dataOf<Tab>(await open(cashier, { label: uniq('Tab') }))

        const added = dataOf<Tab>(await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 3 }]))
        expect(added.items).toEqual([expect.objectContaining({ product_id: product.id, quantity: 3, unit_price: 5 })])
        expect(await stockOf(product.id)).toBe(7)
        expect(added.totals).toMatchObject({ subtotal: 15, tax: 1.5, total: 16.5, paid: 0, balance: 16.5 })

        // Adding the same product again sums the quantity instead of creating a second line (the price is a photo).
        const addedAgain = dataOf<Tab>(await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 2 }]))
        expect(addedAgain.items).toHaveLength(1)
        expect(addedAgain.items[0]?.quantity).toBe(5)
        expect(await stockOf(product.id)).toBe(5)

        const itemId = addedAgain.items[0]!.id
        const cashierTried = await removeItem(cashier, tab.id, itemId, { quantity: 1, reason: 'oops' })
        expect(cashierTried.status).toBe(403)
        expect(await stockOf(product.id)).toBe(5)

        const removed = dataOf<Tab>(
            await removeItem(manager, tab.id, itemId, { quantity: 2, reason: 'customer changed their mind' })
        )
        expect(removed.items[0]?.quantity).toBe(3)
        expect(await stockOf(product.id)).toBe(7)
    })

    test('two tabs racing for the last units: one succeeds, the other gets "Insufficient stock"', async () => {
        const product = await createProduct({ selling_price: 5, stock: 5 })
        const [tabA, tabB] = await Promise.all([
            open(cashier, { label: uniq('A') }).then(response => dataOf<Tab>(response)),
            open(manager, { label: uniq('B') }).then(response => dataOf<Tab>(response))
        ])

        const [resultA, resultB] = await Promise.all([
            addItems(cashier, tabA.id, [{ product_id: product.id, quantity: 4 }]),
            addItems(manager, tabB.id, [{ product_id: product.id, quantity: 4 }])
        ])
        const statuses = [resultA.status, resultB.status].sort()
        expect(statuses).toEqual([200, 422])
        const failed = resultA.status === 422 ? resultA : resultB
        expect(errorOf(failed).message).toMatch(/^Insufficient stock for "/)
        expect(await stockOf(product.id)).toBe(1)
    })
})

describe('splitting the bill with partial payments', () => {
    test('three people paying in equal parts close the tab into a completed order with 3 payments', async () => {
        const product = await createProduct({ selling_price: 30, tax_rate: 0, stock: 10 })
        const tab = dataOf<Tab>(await open(cashier, { label: uniq('Split'), members: ['Jhon', 'Carlos', 'Bleidis'] }))
        const withItems = dataOf<Tab>(await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 3 }]))
        expect(withItems.totals.total).toBe(90)
        const [jhon, carlos, bleidis] = withItems.members

        const first = dataOf<Tab>(
            await pay(cashier, tab.id, { member_id: jhon!.id, payment_method: 'cash', amount: 30 })
        )
        expect(first.status).toBe('open')
        expect(first.totals).toMatchObject({ paid: 30, balance: 60 })

        const second = dataOf<Tab>(
            await pay(cashier, tab.id, { member_id: carlos!.id, payment_method: 'card', amount: 30 })
        )
        expect(second.status).toBe('open')
        expect(second.totals.balance).toBe(30)

        const closed = dataOf<Tab>(
            await pay(cashier, tab.id, { member_id: bleidis!.id, payment_method: 'ewallet', amount: 30 })
        )
        expect(closed.status).toBe('closed')
        expect(closed.totals).toMatchObject({ paid: 90, balance: 0 })
        expect(closed.order_id).toBeTruthy()

        const orderId = closed.order_id!
        const order = dataOf<Order>(await manager.get(getOrder, `orders/${orderId}`, { params: { id: orderId } }))
        expect(order).toMatchObject({ status: 'completed', total: 90, tab_id: tab.id })
        expect(order.items).toEqual([expect.objectContaining({ product_id: product.id, quantity: 3 })])
        expect(order.payments.map(payment => payment.amount).sort((a, b) => a - b)).toEqual([30, 30, 30])
        expect(order.payments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(order.total)
    })
})

describe('overpaying and voiding', () => {
    test('a single payment above the balance is rejected', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const tab = dataOf<Tab>(await open(cashier, { label: uniq('Over') }))
        await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 1 }])
        const response = await pay(cashier, tab.id, { payment_method: 'cash', amount: 999 })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toBe('The amount exceeds the balance')
    })

    test('two concurrent payments that together exceed the balance: one is rejected', async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
            const tab = dataOf<Tab>(await open(cashier, { label: uniq('Race') }))
            await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 1 }]) // total = 10

            const [a, b] = await Promise.all([
                pay(cashier, tab.id, { payment_method: 'cash', amount: 6 }),
                pay(manager, tab.id, { payment_method: 'card', amount: 6 })
            ])
            const statuses = [a.status, b.status].sort()
            expect(statuses).toEqual([200, 422])

            const final = dataOf<Tab>(await detail(cashier, tab.id))
            expect(final.totals.paid).toBe(6)
            expect(final.status).toBe('open')
        }
    })

    test('voiding requires no prior payments, and returns every item’s stock', async () => {
        const product = await createProduct({ selling_price: 10, stock: 5 })
        const tab = dataOf<Tab>(await open(cashier, { label: uniq('Void') }))
        await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 2 }])
        expect(await stockOf(product.id)).toBe(3)

        await pay(cashier, tab.id, { payment_method: 'cash', amount: 5 })
        const withPayment = await voidIt(manager, tab.id, 'changed their mind')
        expect(withPayment.status).toBe(422)
        expect(errorOf(withPayment).message).toBe('A tab with payments cannot be voided')

        const productNoPay = await createProduct({ selling_price: 10, stock: 5 })
        const tab2 = dataOf<Tab>(await open(cashier, { label: uniq('Void2') }))
        await addItems(cashier, tab2.id, [{ product_id: productNoPay.id, quantity: 2 }])
        expect(await stockOf(productNoPay.id)).toBe(3)

        const cashierTried = await voidIt(cashier, tab2.id, 'not a manager')
        expect(cashierTried.status).toBe(403)

        const voided = dataOf<Tab>(await voidIt(manager, tab2.id, 'customer left without paying'))
        expect(voided.status).toBe('voided')
        expect(await stockOf(productNoPay.id)).toBe(5)
    })
})

describe('a closed tab becomes a normal, refundable order', () => {
    test('refunding the resulting order returns the stock', async () => {
        const product = await createProduct({ selling_price: 20, tax_rate: 0, stock: 10 })
        const tab = dataOf<Tab>(await open(cashier, { label: uniq('Refund') }))
        await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 2 }])
        const closed = dataOf<Tab>(await pay(cashier, tab.id, { payment_method: 'cash', amount: 40 }))
        expect(closed.status).toBe('closed')
        expect(await stockOf(product.id)).toBe(8)

        const orderId = closed.order_id!
        const response = await manager.post(refund, `orders/${orderId}/refund`, {
            params: { id: orderId },
            body: { reason: 'customer returned the goods' }
        })
        expect(response.status).toBe(200)
        expect(await stockOf(product.id)).toBe(10)
    })
})

describe('the order closed from a tab records the rate that was actually charged', () => {
    test('order_items.tax_rate is the rate frozen on the tab line, not the product rate at close time', async () => {
        const product = await createProduct({ selling_price: 100, tax_rate: 0.19, stock: 10 })
        const tab = dataOf<Tab>(await open(cashier, { label: uniq('Rate') }))
        await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 1 }])

        // A manager changes the product's rate while the tab is still open.
        const { error: updateError } = await adminClient()
            .from('products')
            .update({ tax_rate: 0.05 })
            .eq('id', product.id)
        expect(updateError).toBeNull()

        const closed = dataOf<Tab>(await pay(cashier, tab.id, { payment_method: 'cash', amount: 119 }))
        expect(closed.status).toBe('closed')

        const { data: lines, error } = await adminClient()
            .from('order_items')
            .select('tax_rate, tax')
            .eq('order_id', closed.order_id!)
        expect(error).toBeNull()
        expect(lines).toEqual([{ tax_rate: 0.19, tax: 19 }])
    })
})

describe('RLS: tabs, tab_items and tab_payments are read-only from the client', () => {
    test('a cashier cannot write to them directly, and everything is written through the RPCs', async () => {
        const db = await signedInClient('cashier')
        const insertTab = await db.from('tabs').insert({ tab_number: uniq('TAB'), label: 'direct insert' })
        expect(insertTab.error?.code).toBe('42501')

        const product = await createProduct({ selling_price: 10, stock: 5 })
        const tab = dataOf<Tab>(await open(cashier, { label: uniq('RLS') }))
        await addItems(cashier, tab.id, [{ product_id: product.id, quantity: 1 }])

        const updateItem = await db.from('tab_items').update({ quantity: 99 }).eq('tab_id', tab.id)
        expect(updateItem.error?.code).toBe('42501')

        const insertPayment = await db
            .from('tab_payments')
            .insert({ tab_id: tab.id, payment_method: 'cash', amount: 1 })
        expect(insertPayment.error?.code).toBe('42501')
    })

    test('anon sees nothing (no table privileges at all, like every other table)', async () => {
        const { createClient } = await import('@supabase/supabase-js')
        const anonClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
        )
        for (const table of ['tabs', 'tab_members', 'tab_items', 'tab_payments'] as const) {
            const { error } = await anonClient.from(table).select('id').limit(1)
            expect(error?.code).toBe('42501')
        }
    })
})
