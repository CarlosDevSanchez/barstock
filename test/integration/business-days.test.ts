import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GET as cronTick } from '@/app/api/cron/tick/route'
import { GET as getDay, PATCH as adjustDay } from '@/app/api/v1/business-days/[id]/route'
import { POST as closeDay } from '@/app/api/v1/business-days/[id]/close/route'
import { GET as current } from '@/app/api/v1/business-days/current/route'
import { GET as listDays, POST as openDay } from '@/app/api/v1/business-days/route'
import { GET as listRegisters, POST as createRegister } from '@/app/api/v1/cash-registers/route'
import { POST as closeSession } from '@/app/api/v1/cash-sessions/[id]/close/route'
import { POST as addMovement } from '@/app/api/v1/cash-sessions/[id]/movements/route'
import { GET as getSession } from '@/app/api/v1/cash-sessions/[id]/route'
import { POST as openSession } from '@/app/api/v1/cash-sessions/route'
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

function justAfter(openedAt: string): string {
    // After the open, and not in the future: a future closed_at still owns a sale made now.
    return new Date(Math.max(new Date(openedAt).getTime() + 1, Date.now() - 1)).toISOString()
}

async function closeAnyDay() {
    const now = new Date().toISOString()
    const open = await service().from('business_days').select('id, opened_at').is('closed_at', null)
    if (open.error) throw open.error
    const future = await service().from('business_days').select('id, opened_at').gt('closed_at', now)
    if (future.error) throw future.error
    const data = [...(open.data ?? []), ...(future.data ?? [])]
    for (const day of data) {
        const openSessions = await service()
            .from('cash_sessions')
            .select('id, opened_at')
            .eq('business_day_id', day.id)
            .eq('status', 'open')
        if (openSessions.error) throw openSessions.error
        for (const session of openSessions.data ?? []) {
            const sessions = await service()
                .from('cash_sessions')
                .update({ status: 'closed', closed_at: justAfter(session.opened_at) })
                .eq('id', session.id)
            if (sessions.error) throw sessions.error
        }
        const closed = await service()
            .from('business_days')
            .update({ closed_at: justAfter(day.opened_at), close_kind: 'manual' })
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

    test('the cash routes open a day, move the drawer and report it', async () => {
        await closeAnyDay()
        const [cashierHttp, managerHttp, adminHttp] = await Promise.all([
            loginAs('cashier'),
            loginAs('manager'),
            loginAs('admin')
        ])

        const empty = await cashierHttp.get(current, 'business-days/current')
        expect(empty.status).toBe(200)
        expect(dataOf<{ day: unknown }>(empty).day).toBeNull()

        const opened = await cashierHttp.post(openDay, 'business-days', { body: {} })
        expect(opened.status).toBe(201)
        const day = dataOf<{ id: string; opened_at: string }>(opened)

        const registers = dataOf<{ id: string; name: string }[]>(await cashierHttp.get(listRegisters, 'cash-registers'))
        const caja = registers.find(register => register.name === 'Caja 1')
        expect(caja).toBeTruthy()

        const beforeTill = dataOf<{ sessions: unknown[] }>(await cashierHttp.get(current, 'business-days/current'))
        expect(beforeTill.sessions).toEqual([])

        const session = await cashierHttp.post(openSession, 'cash-sessions', {
            body: { register_id: caja!.id, opening_float: 1000, user_ids: [users.cashier.id] }
        })
        expect(session.status).toBe(201)
        const sessionId = dataOf<{ id: string }>(session).id

        const movement = await cashierHttp.post(addMovement, `cash-sessions/${sessionId}/movements`, {
            params: { id: sessionId },
            body: { kind: 'withdrawal', amount: 200, reason: 'cambio' }
        })
        expect(movement.status).toBe(201)

        const live = dataOf<{ sessions: { expected_cash: number; movements: { reason: string }[] }[] }>(
            await cashierHttp.get(current, 'business-days/current')
        )
        expect(live.sessions[0]?.expected_cash).toBe(800)
        expect(live.sessions[0]?.movements[0]?.reason).toBe('cambio')
        expect(
            (await cashierHttp.get(getSession, `cash-sessions/${sessionId}`, { params: { id: sessionId } })).status
        ).toBe(200)

        const counted = await cashierHttp.post(closeSession, `cash-sessions/${sessionId}/close`, {
            params: { id: sessionId },
            body: { counted_cash: 800 }
        })
        expect(counted.status).toBe(204)
        expect(
            (
                await cashierHttp.get(getSession, 'cash-sessions/00000000-0000-4000-8000-000000000000', {
                    params: { id: '00000000-0000-4000-8000-000000000000' }
                })
            ).status
        ).toBe(404)

        expect((await cashierHttp.get(listDays, 'business-days')).status).toBe(403)
        expect((await managerHttp.get(listDays, 'business-days')).status).toBe(200)
        expect((await managerHttp.get(listDays, 'business-days?needs_review=false')).status).toBe(200)
        expect((await managerHttp.get(getDay, `business-days/${day.id}`, { params: { id: day.id } })).status).toBe(200)

        const adjusted = await adminHttp.patch(adjustDay, `business-days/${day.id}`, {
            params: { id: day.id },
            body: { opened_at: day.opened_at, notes: 'reviewed from the api' }
        })
        expect(adjusted.status).toBe(200)
        expect(
            (await cashierHttp.post(closeDay, `business-days/${day.id}/close`, { params: { id: day.id }, body: {} }))
                .status
        ).toBe(200)
        expect(
            (await adminHttp.post(createRegister, 'cash-registers', { body: { name: `Caja ${Date.now()}` } })).status
        ).toBe(201)
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
