import { beforeAll, describe, expect, test } from 'bun:test'
import { POST as createCategory } from '@/app/api/v1/expense-categories/route'
import { DELETE as voidExpenseRoute } from '@/app/api/v1/expenses/[id]/route'
import { GET as listExpenses, POST as createExpenseRoute } from '@/app/api/v1/expenses/route'
import {
    adminClient,
    createProduct,
    ensureTestUsers,
    signedInClient,
    type Db,
    type TestUsers
} from '../helpers/integration'
import { dataOf, loginAs } from '../helpers/http'

let cashier: Db
let manager: Db
let users: TestUsers
const service = () => adminClient()

function justAfter(openedAt: string): string {
    return new Date(Math.max(new Date(openedAt).getTime() + 1, Date.now() - 1)).toISOString()
}

async function closeAnyDay() {
    const now = new Date().toISOString()
    const open = await service().from('business_days').select('id, opened_at').is('closed_at', null)
    if (open.error) throw open.error
    const future = await service().from('business_days').select('id, opened_at').gt('closed_at', now)
    if (future.error) throw future.error
    for (const day of [...(open.data ?? []), ...(future.data ?? [])]) {
        const openSessions = await service()
            .from('cash_sessions')
            .select('id, opened_at')
            .eq('business_day_id', day.id)
            .eq('status', 'open')
        if (openSessions.error) throw openSessions.error
        for (const session of openSessions.data ?? []) {
            const closed = await service()
                .from('cash_sessions')
                .update({ status: 'closed', closed_at: justAfter(session.opened_at) })
                .eq('id', session.id)
            if (closed.error) throw closed.error
        }
        const closedDay = await service()
            .from('business_days')
            .update({ closed_at: justAfter(day.opened_at), close_kind: 'manual' })
            .eq('id', day.id)
        if (closedDay.error) throw closedDay.error
    }
}

async function categoryId(name: string) {
    const { data, error } = await service().from('expense_categories').select('id').eq('name', name).single()
    if (error) throw error
    return data.id
}

async function openTill(float = 1000) {
    await closeAnyDay()
    const day = await manager.rpc('open_business_day', { p_notes: null as unknown as string })
    if (day.error) throw day.error
    const register = await service().from('cash_registers').select('id').eq('name', 'Caja 1').single()
    if (register.error) throw register.error
    const session = await manager.rpc('open_cash_session', {
        p_register_id: register.data.id,
        p_opening_float: float,
        p_user_ids: [users.cashier.id]
    })
    if (session.error) throw session.error
    return session.data as string
}

beforeAll(async () => {
    users = await ensureTestUsers()
    ;[cashier, manager] = await Promise.all([signedInClient('cashier'), signedInClient('manager')])
})

describe('expenses', () => {
    test('a cash expense on a closed till is rejected and an open till drops expected cash', async () => {
        const sessionId = await openTill()
        const category = await categoryId('Insumos')
        const closed = await manager.rpc('close_cash_session', {
            p_session_id: sessionId,
            p_counted_cash: 1000,
            p_notes: null as unknown as string
        })
        if (closed.error) throw closed.error

        const rejected = await manager.rpc('create_expense', {
            p_category_id: category,
            p_description: 'after close',
            p_amount: 50,
            p_payment_method: 'cash',
            p_occurred_at: new Date().toISOString(),
            p_supplier_id: null as unknown as string,
            p_cash_session_id: sessionId
        })
        expect(rejected.error?.code).toBe('P0001')

        const openId = await openTill()
        const created = await manager.rpc('create_expense', {
            p_category_id: category,
            p_description: 'change fund',
            p_amount: 200,
            p_payment_method: 'cash',
            p_occurred_at: new Date().toISOString(),
            p_supplier_id: null as unknown as string,
            p_cash_session_id: openId
        })
        expect(created.error).toBeNull()
        const summary = await manager.rpc('cash_session_summary', { p_session_id: openId })
        if (summary.error) throw summary.error
        expect(Number((summary.data as { expected_cash: number }).expected_cash)).toBe(800)
    })

    test('a cashier cannot create an expense', async () => {
        const category = await categoryId('Otros')
        const rpc = await cashier.rpc('create_expense', {
            p_category_id: category,
            p_description: 'nope',
            p_amount: 10,
            p_payment_method: 'cash',
            p_occurred_at: null as unknown as string,
            p_supplier_id: null as unknown as string,
            p_cash_session_id: null as unknown as string
        })
        expect(rpc.error?.code).toBe('42501')

        const http = await loginAs('cashier')
        const response = await http.post(createExpenseRoute, 'expenses', {
            body: { category_id: category, description: 'nope', amount: 10, payment_method: 'cash' }
        })
        expect(response.status).toBe(403)
    })

    test('cost is snapshotted and net profit subtracts the expense', async () => {
        const zoneRow = await service().from('settings').select('value').eq('key', 'timezone').single()
        if (zoneRow.error) throw zoneRow.error
        const zone = typeof zoneRow.data.value === 'string' ? zoneRow.data.value : 'UTC'
        const day = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date())
        const before = await manager.rpc('sales_report', { p_from: day, p_to: day })
        if (before.error) throw before.error
        const prior = before.data as { total_cogs: number; total_expenses: number; net_profit: number }

        const product = await createProduct({ cost_price: 100, selling_price: 200, tax_rate: 0, stock: 5 })
        const sale = await manager.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        if (sale.error) throw sale.error

        const line = await service().from('order_items').select('unit_cost').eq('order_id', sale.data).single()
        if (line.error) throw line.error
        expect(Number(line.data.unit_cost)).toBe(100)

        const bumped = await service().from('products').update({ cost_price: 999 }).eq('id', product.id)
        if (bumped.error) throw bumped.error

        const category = await categoryId('Servicios')
        const managerHttp = await loginAs('manager')
        const created = await managerHttp.post(createExpenseRoute, 'expenses', {
            body: {
                category_id: category,
                description: 'power',
                amount: 30,
                payment_method: 'card',
                occurred_at: new Date().toISOString()
            }
        })
        expect(created.status).toBe(201)
        const expenseId = dataOf<{ id: string }>(created).id

        const listed = await managerHttp.get(listExpenses, `expenses?from=${day}&to=${day}`)
        expect(listed.status).toBe(200)
        const page = dataOf<{ rows: { id: string }[]; byCategory: { category: string; total: number }[] }>(listed)
        expect(page.rows.some(row => row.id === expenseId)).toBe(true)
        expect(page.byCategory.find(row => row.category === 'Servicios')?.total).toBeGreaterThanOrEqual(30)

        const after = await manager.rpc('sales_report', { p_from: day, p_to: day })
        if (after.error) throw after.error
        const next = after.data as { total_cogs: number; total_expenses: number; net_profit: number }
        expect(next.total_cogs - prior.total_cogs).toBeCloseTo(100, 2)
        expect(next.total_expenses - prior.total_expenses).toBeCloseTo(30, 2)
        // gross 100 − discount 0 − expense 30
        expect(next.net_profit - prior.net_profit).toBeCloseTo(70, 2)

        const adminHttp = await loginAs('admin')
        expect(
            (
                await managerHttp.delete(voidExpenseRoute, `expenses/${expenseId}`, {
                    params: { id: expenseId },
                    body: { reason: 'duplicate' }
                })
            ).status
        ).toBe(403)
        expect(
            (
                await adminHttp.delete(voidExpenseRoute, `expenses/${expenseId}`, {
                    params: { id: expenseId },
                    body: { reason: 'duplicate' }
                })
            ).status
        ).toBe(204)

        const categoryResponse = await adminHttp.post(createCategory, 'expense-categories', {
            body: { name: `Extra ${Date.now()}` }
        })
        expect(categoryResponse.status).toBe(201)
        expect((await managerHttp.post(createCategory, 'expense-categories', { body: { name: 'Nope' } })).status).toBe(
            403
        )
    })
})
