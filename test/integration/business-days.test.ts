import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GET as cronTick } from '@/app/api/cron/tick/route'
import {
    adminClient,
    createProduct,
    ensureTestUsers,
    signedInClient,
    type Db,
    type TestUsers
} from '../helpers/integration'

let cashier: Db
let manager: Db
let admin: Db
let users: TestUsers
const service = () => adminClient()

const sell = (db: Db, productId: string) =>
    db.rpc('create_sale', {
        p_customer_id: null as unknown as string,
        p_items: [{ product_id: productId, quantity: 1 }],
        p_payment_method: 'cash',
        p_discount: 0
    })

async function closeAnyDay() {
    const { data, error } = await service().from('business_days').select('id').is('closed_at', null)
    if (error) throw error
    const closedAt = new Date(Date.now() + 5000).toISOString()
    for (const day of data ?? []) {
        const sessions = await service()
            .from('cash_sessions')
            .update({ status: 'closed', closed_at: closedAt })
            .eq('business_day_id', day.id)
            .eq('status', 'open')
        if (sessions.error) throw sessions.error
        const closed = await service()
            .from('business_days')
            .update({ closed_at: closedAt, close_kind: 'manual' })
            .eq('id', day.id)
        if (closed.error) throw closed.error
    }
}

async function registerId() {
    const { data, error } = await service().from('cash_registers').select('id').eq('name', 'Caja 1').single()
    if (error) throw error
    return data.id
}

beforeAll(async () => {
    users = await ensureTestUsers()
    ;[cashier, manager, admin] = await Promise.all([
        signedInClient('cashier'),
        signedInClient('manager'),
        signedInClient('admin')
    ])
})

afterAll(closeAnyDay)

describe('business days and cash sessions', () => {
    test('a sale with no open day completes and stays outside the day', async () => {
        await closeAnyDay()
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 2 })
        const sold = await sell(cashier, product.id)
        expect(sold.error).toBeNull()
        const { data } = await service()
            .from('orders')
            .select('business_day_id, cash_session_id')
            .eq('id', sold.data!)
            .single()
        expect(data).toEqual({ business_day_id: null, cash_session_id: null })
    })

    test('float plus a cash sale minus a withdrawal is the expected count', async () => {
        await closeAnyDay()
        const dayId = (await cashier.rpc('open_business_day', {})).data
        expect(dayId).toBeTruthy()
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 90000,
            p_user_ids: [users.cashier.id]
        })
        expect(session.error).toBeNull()
        const product = await createProduct({ selling_price: 50000, tax_rate: 0, stock: 2 })
        expect((await sell(cashier, product.id)).error).toBeNull()
        const movement = await cashier.rpc('add_cash_movement', {
            p_session_id: session.data!,
            p_kind: 'withdrawal',
            p_amount: 20000,
            p_reason: 'safe drop'
        })
        expect(movement.error).toBeNull()
        const summary = await cashier.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(summary.data).toMatchObject({ expected_cash: 120000 })
        expect(
            (await cashier.rpc('close_cash_session', { p_session_id: session.data!, p_counted_cash: 120000 })).error
        ).toBeNull()
        const { data } = await service()
            .from('cash_sessions')
            .select('expected_cash, counted_cash, difference, needs_review')
            .eq('id', session.data!)
            .single()
        expect(data).toEqual({ expected_cash: 120000, counted_cash: 120000, difference: 0, needs_review: false })
    })

    test('any difference above a zero tolerance is flagged', async () => {
        await closeAnyDay()
        await cashier.rpc('open_business_day', {})
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 1000,
            p_user_ids: [users.cashier.id]
        })
        expect(
            (await cashier.rpc('close_cash_session', { p_session_id: session.data!, p_counted_cash: 1001 })).error
        ).toBeNull()
        const { data } = await service()
            .from('cash_sessions')
            .select('difference, needs_review')
            .eq('id', session.data!)
            .single()
        expect(data).toEqual({ difference: 1, needs_review: true })
    })

    test('a tab cash payment is counted once after the tab closes', async () => {
        await closeAnyDay()
        await cashier.rpc('open_business_day', {})
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 0,
            p_user_ids: [users.cashier.id]
        })
        const product = await createProduct({ selling_price: 80, tax_rate: 0, stock: 2 })
        const tab = await cashier.rpc('open_tab', {
            p_label: 'Bar',
            p_customer_id: null as unknown as string,
            p_members: []
        })
        expect(tab.error).toBeNull()
        expect(
            (
                await cashier.rpc('tab_add_items', {
                    p_tab_id: tab.data!,
                    p_items: [{ product_id: product.id, quantity: 1 }]
                })
            ).error
        ).toBeNull()
        expect(
            (
                await cashier.rpc('tab_pay', {
                    p_tab_id: tab.data!,
                    p_member_id: null as unknown as string,
                    p_method: 'cash',
                    p_amount: 40
                })
            ).error
        ).toBeNull()
        const open = await cashier.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(open.data).toMatchObject({ expected_cash: 40, cash_sales: 0, open_tab_cash: 40 })
        expect(
            (
                await cashier.rpc('tab_pay', {
                    p_tab_id: tab.data!,
                    p_member_id: null as unknown as string,
                    p_method: 'cash',
                    p_amount: 40
                })
            ).error
        ).toBeNull()
        const closed = await cashier.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(closed.data).toMatchObject({ expected_cash: 80, cash_sales: 80, open_tab_cash: 0 })
    })

    test('a day open for 25 hours closes itself on the next sale', async () => {
        await closeAnyDay()
        const opened = await cashier.rpc('open_business_day', {})
        const openedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
        const moved = await service().from('business_days').update({ opened_at: openedAt }).eq('id', opened.data!)
        expect(moved.error).toBeNull()
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        expect((await sell(cashier, product.id)).error).toBeNull()
        const { data } = await service()
            .from('business_days')
            .select('close_kind, needs_review, closed_at')
            .eq('id', opened.data!)
            .single()
        expect(data?.close_kind).toBe('auto')
        expect(data?.needs_review).toBe(true)
        expect(new Date(data!.closed_at!).getTime()).toBe(new Date(openedAt).getTime() + 24 * 60 * 60 * 1000)
    })

    test('two concurrent opens produce one day', async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            await closeAnyDay()
            const [a, b] = await Promise.all([
                cashier.rpc('open_business_day', {}),
                manager.rpc('open_business_day', {})
            ])
            const won = [a, b].filter(result => result.data)
            const lost = [a, b].filter(result => result.error)
            expect(won).toHaveLength(1)
            expect(lost).toHaveLength(1)
            expect(lost[0]?.error?.message).toMatch(/already open/)
        }
    })

    test('a cashier cannot adjust a business day', async () => {
        await closeAnyDay()
        const opened = await cashier.rpc('open_business_day', {})
        const denied = await cashier.rpc('adjust_business_day', {
            p_id: opened.data!,
            p_opened_at: new Date(Date.now() - 60_000).toISOString(),
            p_closed_at: new Date().toISOString()
        })
        expect(denied.error?.code).toBe('42501')
        const allowed = await admin.rpc('adjust_business_day', {
            p_id: opened.data!,
            p_opened_at: new Date(Date.now() - 60_000).toISOString(),
            p_closed_at: new Date(Date.now() + 60_000).toISOString(),
            p_notes: 'reviewed'
        })
        expect(allowed.error).toBeNull()
        const { data } = await service().from('business_days').select('needs_review').eq('id', opened.data!).single()
        expect(data?.needs_review).toBe(false)
    })

    test('the cron route rejects a missing secret and closes a stale day with the right one', async () => {
        await closeAnyDay()
        const opened = await cashier.rpc('open_business_day', {})
        const openedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
        await service().from('business_days').update({ opened_at: openedAt }).eq('id', opened.data!)

        const previous = process.env.CRON_SECRET
        delete process.env.CRON_SECRET
        expect((await cronTick(new Request('http://localhost/api/cron/tick'))).status).toBe(503)
        process.env.CRON_SECRET = 'phase-b-test-secret'
        expect((await cronTick(new Request('http://localhost/api/cron/tick'))).status).toBe(401)
        const ok = await cronTick(
            new Request('http://localhost/api/cron/tick', { headers: { authorization: 'Bearer phase-b-test-secret' } })
        )
        expect(ok.status).toBe(200)
        if (previous === undefined) delete process.env.CRON_SECRET
        else process.env.CRON_SECRET = previous

        const { data } = await service().from('business_days').select('close_kind').eq('id', opened.data!).single()
        expect(data?.close_kind).toBe('auto')
    })
})
