import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PATCH as patchProduct } from '@/app/api/v1/products/[id]/route'
import { POST as postProduct } from '@/app/api/v1/products/route'
import { POST as postSale } from '@/app/api/v1/sales/route'
import type { Database } from '@/types/database'
import { previewTotals } from '@/lib/cart-preview'
import { currencyDecimals, ZERO_DECIMAL_CURRENCIES } from '@/lib/money'
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
import { dataOf, errorOf, loginAs, TestClient } from '../helpers/http'

let cashier: TestClient
let manager: TestClient
let restoreCurrency: () => Promise<void>

beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('COP')
    ;[cashier, manager] = await Promise.all([loginAs('cashier'), loginAs('manager')])
})
afterAll(async () => {
    await restoreCurrency()
})

interface Order {
    subtotal: number
    tax: number
    discount: number
    total: number
    items: Array<{ unit_price: number; tax: number; total: number }>
    payments: Array<{ amount: number }>
}
const sale = (client: TestClient, body: unknown) => client.post(postSale, 'sales', { body })
const patchParams = (id: string) => ({ params: { id } })

describe('the decimals list is the same in TypeScript and in the database', () => {
    test('currency_decimals() agrees with currencyDecimals() for every currency Intl knows', async () => {
        const admin = adminClient()
        const currencies = [...new Set([...Intl.supportedValuesOf('currency'), ...ZERO_DECIMAL_CURRENCIES])]
        expect(currencies.length).toBeGreaterThan(100)
        const mismatches: string[] = []
        // Sequential batches keep the number of simultaneous requests low.
        for (let start = 0; start < currencies.length; start += 25) {
            await Promise.all(
                currencies.slice(start, start + 25).map(async currency => {
                    const { data, error } = await admin.rpc('currency_decimals', { p_currency: currency })
                    if (error) throw error
                    if (data !== currencyDecimals(currency)) mismatches.push(`${currency}: sql=${data}`)
                })
            )
        }
        expect(mismatches).toEqual([])
    })

    test('money_scale() follows settings.currency', async () => {
        const admin = adminClient()
        const restore = await pinStoreCurrency('USD')
        try {
            expect((await admin.rpc('money_scale')).data).toBe(2)
            await pinStoreCurrency('COP')
            expect((await admin.rpc('money_scale')).data).toBe(0)
            await pinStoreCurrency('eur') // not a valid code, but the scale must still resolve (2)
            expect((await admin.rpc('money_scale')).data).toBe(2)
        } finally {
            await restore()
        }
    })

    test('a signed-in user can call it, an anonymous one cannot', async () => {
        const signedIn: Db = await signedInClient('cashier')
        expect((await signedIn.rpc('money_scale')).data).toBe(0)
        const anonymous = createClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
        )
        expect((await anonymous.rpc('money_scale')).error).not.toBeNull()
        expect((await anonymous.rpc('currency_decimals', { p_currency: 'COP' })).error).not.toBeNull()
    })
})

describe('COP: whole pesos from the till to the database', () => {
    test('35 000 with 19 % IVA charges 41 650 and stores whole pesos', async () => {
        const product = await createProduct({ selling_price: 35000, cost_price: 20000, tax_rate: 0.19, stock: 10 })
        const response = await sale(cashier, {
            payment_method: 'cash',
            items: [{ product_id: product.id, quantity: 1 }]
        })
        expect(response.status).toBe(201)
        const order = dataOf<Order>(response)
        expect(order).toMatchObject({ subtotal: 35000, tax: 6650, discount: 0, total: 41650 })
        expect(order.items[0]).toMatchObject({ unit_price: 35000, tax: 6650, total: 41650 })
        expect(order.payments).toEqual([expect.objectContaining({ amount: 41650 })])
        expect(await stockOf(product.id)).toBe(9)
    })

    test('the till preview (previewTotals with 0 decimals) matches create_sale to the peso', async () => {
        // Prices and rates chosen so that the tax of a line lands on .5 or close to it.
        const cases = [
            { price: 1999, rate: 0.19, quantity: 1, discount: 0 }, // 379.81
            { price: 1999, rate: 0.19, quantity: 3, discount: 0 }, // 1139.43
            { price: 25, rate: 0.1, quantity: 1, discount: 0 }, // 2.5 -> 3 (half up)
            { price: 5, rate: 0.1, quantity: 1, discount: 0 }, // 0.5 -> 1
            { price: 89900, rate: 0.19, quantity: 2, discount: 4900 }, // discount reduces the taxable base
            { price: 35000, rate: 0.05, quantity: 7, discount: 0 },
            { price: 12345, rate: 0.0725, quantity: 4, discount: 345 }
        ]
        const products = await Promise.all(
            cases.map(item => createProduct({ selling_price: item.price, tax_rate: item.rate, stock: 100 }))
        )
        for (const globalDiscount of [0, 1500]) {
            const lines = cases.map((item, index) => ({ product: products[index]!, item }))
            const order = dataOf<Order>(
                await sale(cashier, {
                    payment_method: 'card',
                    discount: globalDiscount,
                    items: lines.map(({ product, item }) => ({
                        product_id: product.id,
                        quantity: item.quantity,
                        discount: item.discount
                    }))
                })
            )
            const preview = previewTotals(
                lines.map(({ item }) => ({
                    unitPrice: item.price,
                    taxRate: item.rate,
                    quantity: item.quantity,
                    discount: item.discount
                })),
                globalDiscount,
                0
            )
            expect({ subtotal: order.subtotal, tax: order.tax, discount: order.discount, total: order.total }).toEqual(
                preview
            )
            expect(Number.isInteger(order.tax) && Number.isInteger(order.total)).toBe(true)
        }
    })

    test('amounts above the old NUMERIC(10,2) limit are stored (900 000 000 x 100 = 90 000 000 000)', async () => {
        const product = await createProduct({ selling_price: 900_000_000, tax_rate: 0, stock: 200 })
        const response = await sale(cashier, {
            payment_method: 'cash',
            items: [{ product_id: product.id, quantity: 100 }]
        })
        expect(response.status).toBe(201)
        expect(dataOf<Order>(response)).toMatchObject({ subtotal: 90_000_000_000, total: 90_000_000_000 })
    })

    test('the API refuses prices with cents when the store currency has none', async () => {
        const body = (extra: Record<string, unknown>) => ({
            name: uniq('P'),
            sku: uniq('S'),
            selling_price: 35000,
            ...extra
        })

        const created = await manager.post(postProduct, 'products', { body: body({ selling_price: 35000.5 }) })
        expect(created.status).toBe(422)
        expect(created.json<{ error: { details: unknown[] } }>().error.details).toEqual([
            { path: 'selling_price', message: 'validation.noDecimals' }
        ])
        const costly = await manager.post(postProduct, 'products', { body: body({ cost_price: 100.25 }) })
        expect(costly.status).toBe(422)

        const ok = await manager.post(postProduct, 'products', { body: body({ cost_price: 20000 }) })
        expect(ok.status).toBe(201)
        const id = dataOf<{ id: string }>(ok).id
        const patched = await manager.patch(patchProduct, `products/${id}`, {
            ...patchParams(id),
            body: { selling_price: 35000.99 }
        })
        expect(patched.status).toBe(422)
        const { data } = await adminClient().from('products').select('selling_price').eq('id', id).single()
        expect(data?.selling_price).toBe(35000)
        // A patch that does not touch prices is unaffected.
        expect(
            (await manager.patch(patchProduct, `products/${id}`, { ...patchParams(id), body: { name: 'Renamed' } }))
                .status
        ).toBe(200)
    })

    test('discounts with cents are refused by the API and by the RPC, leaving no order behind', async () => {
        const product = await createProduct({ selling_price: 35000, tax_rate: 0.19, stock: 5 })
        const admin = adminClient()
        const { count: before } = await admin.from('orders').select('*', { count: 'exact', head: true })

        for (const body of [
            { discount: 100.5, items: [{ product_id: product.id, quantity: 1 }] },
            { items: [{ product_id: product.id, quantity: 1, discount: 0.5 }] }
        ]) {
            const response = await sale(cashier, { payment_method: 'cash', ...body })
            expect(response.status).toBe(422)
            expect(JSON.stringify(errorOf(response))).toContain('validation.noDecimals')
        }

        // Straight to the RPC (bypassing the API check): the database has the last word.
        const cashierDb = await signedInClient('cashier')
        const rpc = await cashierDb.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_payment_method: 'cash',
            p_discount: 0.5
        })
        expect(rpc.error?.message).toBe('Invalid discount')

        expect(await stockOf(product.id)).toBe(5)
        const { count: after } = await admin.from('orders').select('*', { count: 'exact', head: true })
        expect(after).toBe(before)
    })

    test('a legacy product priced with cents cannot be sold in COP (preview and charge would disagree)', async () => {
        const product = await createProduct({ selling_price: 29.99, tax_rate: 0.19, stock: 5 })
        const response = await sale(cashier, {
            payment_method: 'cash',
            items: [{ product_id: product.id, quantity: 1 }]
        })
        expect(response.status).toBe(422)
        expect(errorOf(response).message).toMatch(/has more decimals than the store currency allows/)
        expect(await stockOf(product.id)).toBe(5)
    })
})

describe('USD keeps cents', () => {
    test('with USD selected, cents are accepted and taxed to the cent', async () => {
        const restore = await pinStoreCurrency('USD')
        try {
            const product = await createProduct({ selling_price: 29.99, tax_rate: 0.1, stock: 5 })
            const created = await manager.post(postProduct, 'products', {
                body: { name: uniq('P'), sku: uniq('S'), selling_price: 3.5 }
            })
            expect(created.status).toBe(201)
            const order = dataOf<Order>(
                await sale(cashier, { payment_method: 'cash', items: [{ product_id: product.id, quantity: 2 }] })
            )
            expect(order).toMatchObject({ subtotal: 59.98, tax: 6, total: 65.98 })
        } finally {
            await restore()
        }
    })
})

describe('anonymous access stays closed', () => {
    test('POST /sales without a session is 401 whatever the currency', async () => {
        expect((await sale(new TestClient(), { items: [], payment_method: 'cash' })).status).toBe(401)
    })
})
