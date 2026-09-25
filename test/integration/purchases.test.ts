import { beforeAll, describe, expect, test } from 'bun:test'
import { POST as receivePurchaseRoute } from '@/app/api/v1/purchases/route'
import { GET as supplierHistoryRoute } from '@/app/api/v1/suppliers/[id]/history/route'
import { adminClient, createProduct, ensureTestUsers, signedInClient, type Db } from '../helpers/integration'
import { dataOf, loginAs } from '../helpers/http'

let cashier: Db
let admin: Db
const service = () => adminClient()

/** Call an RPC that may not yet appear in generated Database types. */
function rpc(db: Db, fn: string, args: Record<string, unknown>) {
    return (db as unknown as { rpc: (name: string, params: Record<string, unknown>) => ReturnType<Db['rpc']> }).rpc(
        fn,
        args
    )
}

async function createSupplier(name: string) {
    const { data, error } = await service().from('suppliers').insert({ name, is_active: true }).select('id').single()
    if (error) throw error
    return data.id as string
}

beforeAll(async () => {
    await ensureTestUsers()
    ;[cashier, admin] = await Promise.all([signedInClient('cashier'), signedInClient('admin')])
})

describe('purchases', () => {
    test('receive increases stock, writes purchase movements, and leaves cost_price alone', async () => {
        const supplierId = await createSupplier(`PO supplier ${crypto.randomUUID().slice(0, 8)}`)
        const product = await createProduct({ cost_price: 100, selling_price: 200, tax_rate: 0, stock: 4 })
        const managerHttp = await loginAs('manager')

        const created = await managerHttp.post(receivePurchaseRoute, 'purchases', {
            body: {
                supplier_id: supplierId,
                items: [
                    { product_id: product.id, quantity: 3, unit_cost: 80 },
                    { product_id: product.id, quantity: 2, unit_cost: 90 }
                ],
                invoice_number: 'FAC-1',
                notes: null,
                cash_session_id: null
            }
        })
        expect(created.status).toBe(201)
        const purchaseId = dataOf<{ id: string }>(created).id

        const stock = await service().from('inventory').select('quantity').eq('product_id', product.id).single()
        if (stock.error) throw stock.error
        expect(stock.data.quantity).toBe(9)

        const catalog = await service().from('products').select('cost_price').eq('id', product.id).single()
        if (catalog.error) throw catalog.error
        expect(Number(catalog.data.cost_price)).toBe(100)

        const moves = await service()
            .from('inventory_transactions')
            .select('*')
            .eq('reference_id', purchaseId)
            .eq('transaction_type', 'purchase')
            .gt('quantity', 0)
        if (moves.error) throw moves.error
        const rows = moves.data as unknown as {
            supplier_id: string
            unit_cost: number
            quantity: number
        }[]
        expect(rows).toHaveLength(2)
        expect(rows.every(row => row.supplier_id === supplierId)).toBe(true)
        expect(rows.map(row => Number(row.unit_cost)).sort()).toEqual([80, 90])
    })

    test('void_purchase with insufficient stock is P0001 and leaves stock unchanged', async () => {
        const supplierId = await createSupplier(`PO void ${crypto.randomUUID().slice(0, 8)}`)
        const product = await createProduct({ cost_price: 50, selling_price: 100, tax_rate: 0, stock: 1 })
        const managerHttp = await loginAs('manager')
        const created = await managerHttp.post(receivePurchaseRoute, 'purchases', {
            body: {
                supplier_id: supplierId,
                items: [{ product_id: product.id, quantity: 5, unit_cost: 40 }],
                cash_session_id: null
            }
        })
        expect(created.status).toBe(201)
        const purchaseId = dataOf<{ id: string }>(created).id

        const burn = await service().from('inventory').update({ quantity: 2 }).eq('product_id', product.id)
        if (burn.error) throw burn.error

        const voided = await rpc(admin, 'void_purchase', { p_id: purchaseId, p_reason: 'too late' })
        expect(voided.error?.code).toBe('P0001')

        const stock = await service().from('inventory').select('quantity').eq('product_id', product.id).single()
        if (stock.error) throw stock.error
        expect(stock.data.quantity).toBe(2)

        const status = await service().from('purchase_orders').select('status').eq('id', purchaseId).single()
        if (status.error) throw status.error
        expect(status.data.status).toBe('received')
    })

    test('history last price and average are correct', async () => {
        const supplierId = await createSupplier(`PO hist ${crypto.randomUUID().slice(0, 8)}`)
        const product = await createProduct({ cost_price: 10, selling_price: 20, tax_rate: 0, stock: 0 })
        const managerHttp = await loginAs('manager')

        for (const [quantity, unit_cost] of [
            [2, 100],
            [2, 200]
        ] as const) {
            const created = await managerHttp.post(receivePurchaseRoute, 'purchases', {
                body: {
                    supplier_id: supplierId,
                    items: [{ product_id: product.id, quantity, unit_cost }],
                    cash_session_id: null
                }
            })
            expect(created.status).toBe(201)
        }

        const zoneRow = await service().from('settings').select('value').eq('key', 'timezone').single()
        if (zoneRow.error) throw zoneRow.error
        const zone = typeof zoneRow.data.value === 'string' ? zoneRow.data.value : 'UTC'
        const day = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date())

        const history = await managerHttp.get(
            supplierHistoryRoute,
            `suppliers/${supplierId}/history?from=${day}&to=${day}`,
            { params: { id: supplierId } }
        )
        expect(history.status).toBe(200)
        const body = dataOf<{
            total: number
            products: { product_id: string; quantity: number; last_unit_cost: number; average_unit_cost: number }[]
        }>(history)
        expect(body.total).toBeCloseTo(600, 2)
        const row = body.products.find(item => item.product_id === product.id)
        expect(row?.quantity).toBe(4)
        expect(row?.last_unit_cost).toBe(200)
        expect(row?.average_unit_cost).toBe(150)
    })

    test('cashier cannot receive a purchase', async () => {
        const supplierId = await createSupplier(`PO cashier ${crypto.randomUUID().slice(0, 8)}`)
        const product = await createProduct({ cost_price: 10, selling_price: 20, tax_rate: 0, stock: 1 })

        const rpcResult = await rpc(cashier, 'receive_purchase', {
            p_supplier_id: supplierId,
            p_items: [{ product_id: product.id, quantity: 1, unit_cost: 10 }],
            p_invoice: null,
            p_notes: null,
            p_cash_session_id: null
        })
        expect(rpcResult.error?.code).toBe('42501')

        const http = await loginAs('cashier')
        const response = await http.post(receivePurchaseRoute, 'purchases', {
            body: {
                supplier_id: supplierId,
                items: [{ product_id: product.id, quantity: 1, unit_cost: 10 }],
                cash_session_id: null
            }
        })
        expect(response.status).toBe(403)
    })
})
