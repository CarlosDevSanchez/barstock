import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
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
    uniq,
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
    // Close every open session directly first, not just the ones under an open/future day: B5 (adjust_business_day)
    // can move a day's closed_at into the past while a session opened against it stays 'open' — a day-scoped
    // query alone would never see that session again, permanently wedging its register for every later test.
    const openSessions = await service().from('cash_sessions').select('id, opened_at').eq('status', 'open')
    if (openSessions.error) throw openSessions.error
    for (const session of openSessions.data ?? []) {
        const closedSession = await service()
            .from('cash_sessions')
            .update({ status: 'closed', closed_at: justAfter(session.opened_at) })
            .eq('id', session.id)
        if (closedSession.error) throw closedSession.error
    }

    const open = await service().from('business_days').select('id, opened_at').is('closed_at', null)
    if (open.error) throw open.error
    const future = await service().from('business_days').select('id, opened_at').gt('closed_at', now)
    if (future.error) throw future.error
    const data = [...(open.data ?? []), ...(future.data ?? [])]
    for (const day of data) {
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
        // R-1: a cashier is blind to the till's expected cash while it is open; a manager still sees it live.
        const cashierSummary = await cashier.rpc('cash_session_summary', { p_session_id: session.data! })
        expect((cashierSummary.data as Record<string, unknown> | null)?.expected_cash).toBeUndefined()
        const summary = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
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
        const open = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
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
        const closed = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
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
        // A random window far in the past (B5's overlap check compares against every other business day,
        // including the many opened/closed within this same test run at "now", and against this same window
        // from a previous run of this test against the same local DB) so it cannot collide with anything else.
        const daysAgo = 100 + Math.floor(Math.random() * 10_000)
        const farPastOpen = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
        const farPastClose = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 + 60_000).toISOString()
        const denied = await cashier.rpc('adjust_business_day', {
            p_id: opened.data!,
            p_opened_at: farPastOpen,
            p_closed_at: farPastClose
        })
        expect(denied.error?.code).toBe('42501')
        const allowed = await admin.rpc('adjust_business_day', {
            p_id: opened.data!,
            p_opened_at: farPastOpen,
            p_closed_at: farPastClose,
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

        // R-1: the cashier's own live view is blind to the till's expected cash; a manager's is not.
        const live = dataOf<{ sessions: { expected_cash: number | null; movements: { reason: string }[] }[] }>(
            await cashierHttp.get(current, 'business-days/current')
        )
        expect(live.sessions[0]?.expected_cash).toBeNull()
        expect(live.sessions[0]?.movements[0]?.reason).toBe('cambio')
        const liveAsManager = dataOf<{ sessions: { expected_cash: number | null }[] }>(
            await managerHttp.get(current, 'business-days/current')
        )
        expect(liveAsManager.sessions[0]?.expected_cash).toBe(800)
        expect(
            (await cashierHttp.get(getSession, `cash-sessions/${sessionId}`, { params: { id: sessionId } })).status
        ).toBe(200)

        const counted = await cashierHttp.post(closeSession, `cash-sessions/${sessionId}/close`, {
            params: { id: sessionId },
            body: { counted_cash: 800 }
        })
        expect(counted.status).toBe(200)
        expect(
            dataOf<{ expected_cash: number; counted_cash: number; difference: number; needs_review: boolean }>(counted)
        ).toEqual({
            expected_cash: 800,
            counted_cash: 800,
            difference: 0,
            needs_review: false
        })
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

// R-B adversarial fixes (B1-B9): see docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md
describe('R-B: cash assignment, concurrency and reconciliation fixes', () => {
    test('B1: an offline sale keeps the session that was open when it happened, never one opened later', async () => {
        await closeAnyDay()
        expect((await cashier.rpc('open_business_day', {})).error).toBeNull()
        const registerB = await service()
            .from('cash_registers')
            .insert({ name: `B1-${Date.now()}` })
            .select('id')
            .single()
        expect(registerB.error).toBeNull()

        const sessionX = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 0,
            p_user_ids: [users.cashier.id]
        })
        expect(sessionX.error).toBeNull()
        const occurredWhileXOpen = new Date().toISOString()
        expect(
            (await cashier.rpc('close_cash_session', { p_session_id: sessionX.data!, p_counted_cash: 0 })).error
        ).toBeNull()

        const sessionY = await cashier.rpc('open_cash_session', {
            p_register_id: registerB.data!.id,
            p_opening_float: 0,
            p_user_ids: [users.cashier.id]
        })
        expect(sessionY.error).toBeNull()

        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const sold = await cashier.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_payment_method: 'cash',
            p_discount: 0,
            p_occurred_at: occurredWhileXOpen
        })
        expect(sold.error).toBeNull()
        const { data: order } = await service().from('orders').select('cash_session_id').eq('id', sold.data!).single()
        // X was already closed by the time the sale is inserted, so B2's own recheck nulls it out too — but it
        // must never be Y, which was not even open when the sale happened.
        expect(order?.cash_session_id).not.toBe(sessionY.data)
        await closeAnyDay()
    })

    test('B2: a sale racing a close never lands in a session whose reconciled figure excludes it', async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
            await closeAnyDay()
            expect((await cashier.rpc('open_business_day', {})).error).toBeNull()
            const session = await cashier.rpc('open_cash_session', {
                p_register_id: await registerId(),
                p_opening_float: 0,
                p_user_ids: [users.cashier.id]
            })
            expect(session.error).toBeNull()
            const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })

            const [saleResult, closeResult] = await Promise.all([
                sell(cashier, product.id),
                cashier.rpc('close_cash_session', { p_session_id: session.data!, p_counted_cash: 0 })
            ])
            expect(saleResult.error).toBeNull()
            expect(closeResult.error).toBeNull()

            const { data: order } = await service()
                .from('orders')
                .select('cash_session_id')
                .eq('id', saleResult.data!)
                .single()
            if (order?.cash_session_id === session.data) {
                const { data: closed } = await service()
                    .from('cash_sessions')
                    .select('expected_cash')
                    .eq('id', session.data!)
                    .single()
                // The frozen expected_cash was computed inside the same lock that admitted this sale to the
                // session, so it must already include it.
                expect(closed?.expected_cash).toBe(10)
            }
        }
    })

    test('B3: a manager with no session of their own refunds cash into the ORIGINAL (still open) till, owned by a different cashier', async () => {
        await closeAnyDay()
        expect((await cashier.rpc('open_business_day', {})).error).toBeNull()
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 0,
            // Only the cashier is responsible for this till — the manager has no session of their own at all.
            p_user_ids: [users.cashier.id]
        })
        expect(session.error).toBeNull()
        const product = await createProduct({ selling_price: 100, tax_rate: 0, stock: 1 })
        const sold = await sell(cashier, product.id)
        expect(sold.error).toBeNull()

        expect(
            (await manager.rpc('refund_order', { p_order_id: sold.data!, p_reason: 'B3 adversarial test' })).error
        ).toBeNull()

        const { data: order } = await service()
            .from('orders')
            .select('refund_cash_session_id, refund_after_close')
            .eq('id', sold.data!)
            .single()
        expect(order).toEqual({ refund_cash_session_id: session.data, refund_after_close: false })

        const summary = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(summary.data).toMatchObject({ refunded_cash: 100, expected_cash: 0 })
        await closeAnyDay()
    })

    test('B3: if the original till has since closed, nothing is subtracted from any till and the order is flagged', async () => {
        await closeAnyDay()
        expect((await cashier.rpc('open_business_day', {})).error).toBeNull()
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 0,
            p_user_ids: [users.cashier.id]
        })
        expect(session.error).toBeNull()
        const product = await createProduct({ selling_price: 100, tax_rate: 0, stock: 1 })
        const sold = await sell(cashier, product.id)
        expect(sold.error).toBeNull()
        expect(
            (await cashier.rpc('close_cash_session', { p_session_id: session.data!, p_counted_cash: 100 })).error
        ).toBeNull()

        expect(
            (await manager.rpc('refund_order', { p_order_id: sold.data!, p_reason: 'B3 closed-till test' })).error
        ).toBeNull()

        const { data: order } = await service()
            .from('orders')
            .select('refund_cash_session_id, refund_after_close')
            .eq('id', sold.data!)
            .single()
        expect(order).toEqual({ refund_cash_session_id: null, refund_after_close: true })

        // The already-closed, already-reconciled session must be completely untouched.
        const { data: sessionRow } = await service()
            .from('cash_sessions')
            .select('expected_cash, counted_cash, difference')
            .eq('id', session.data!)
            .single()
        expect(sessionRow).toEqual({ expected_cash: 100, counted_cash: 100, difference: 0 })
        await closeAnyDay()
    })

    test('B4: closing a day and opening a session on it race safely — no open session survives in a closed day', async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
            await closeAnyDay()
            const opened = await cashier.rpc('open_business_day', {})
            expect(opened.error).toBeNull()
            const registerIdValue = await registerId()
            const [closeResult, openResult] = await Promise.all([
                cashier.rpc('close_business_day', { p_id: opened.data! }),
                cashier.rpc('open_cash_session', {
                    p_register_id: registerIdValue,
                    p_opening_float: 0,
                    p_user_ids: [users.cashier.id]
                })
            ])
            expect(closeResult.error === null || openResult.error === null).toBe(true)
            const { data: openSessions, error } = await service()
                .from('cash_sessions')
                .select('id')
                .eq('business_day_id', opened.data!)
                .eq('status', 'open')
            expect(error).toBeNull()
            expect(openSessions ?? []).toHaveLength(0)
        }
    })

    test('B6 + R-2: voiding a cash expense changes the till only while it is still open', async () => {
        await closeAnyDay()
        expect((await manager.rpc('open_business_day', {})).error).toBeNull()
        const session = await manager.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 100,
            p_user_ids: [users.manager.id]
        })
        expect(session.error).toBeNull()
        const category = await service().from('expense_categories').select('id').eq('name', 'Otros').single()
        expect(category.error).toBeNull()

        const expense = await manager.rpc('create_expense', {
            p_category_id: category.data!.id,
            p_description: 'B6 adversarial test',
            p_amount: 50,
            p_payment_method: 'cash',
            p_occurred_at: null as unknown as string,
            p_supplier_id: null as unknown as string,
            p_cash_session_id: session.data!
        })
        expect(expense.error).toBeNull()
        const whileOpen = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(whileOpen.data).toMatchObject({ expected_cash: 50 })

        expect(
            (await manager.rpc('close_cash_session', { p_session_id: session.data!, p_counted_cash: 50 })).error
        ).toBeNull()
        const afterClose = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(afterClose.data).toMatchObject({ expected_cash: 50 })

        // Voiding AFTER close must not change what was already reconciled (R-2).
        expect(
            (await admin.rpc('void_expense', { p_id: expense.data!, p_reason: 'oops, after close' })).error
        ).toBeNull()
        const afterVoid = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(afterVoid.data).toMatchObject({ expected_cash: 50 })
        const { data: expenseRow } = await service()
            .from('expenses')
            .select('deleted_at, voided_after_close')
            .eq('id', expense.data!)
            .single()
        expect(expenseRow?.voided_after_close).toBe(true)
        expect(expenseRow?.deleted_at).not.toBeNull()
    })

    test('B6: voiding a cash expense while its till is still open restores the amount immediately', async () => {
        await closeAnyDay()
        expect((await manager.rpc('open_business_day', {})).error).toBeNull()
        const session = await manager.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 100,
            p_user_ids: [users.manager.id]
        })
        expect(session.error).toBeNull()
        const category = await service().from('expense_categories').select('id').eq('name', 'Otros').single()
        const expense = await manager.rpc('create_expense', {
            p_category_id: category.data!.id,
            p_description: 'B6 open-till test',
            p_amount: 30,
            p_payment_method: 'cash',
            p_occurred_at: null as unknown as string,
            p_supplier_id: null as unknown as string,
            p_cash_session_id: session.data!
        })
        expect(expense.error).toBeNull()
        expect((await manager.rpc('cash_session_summary', { p_session_id: session.data! })).data).toMatchObject({
            expected_cash: 70
        })
        expect(
            (await admin.rpc('void_expense', { p_id: expense.data!, p_reason: 'voided while open' })).error
        ).toBeNull()
        expect((await manager.rpc('cash_session_summary', { p_session_id: session.data! })).data).toMatchObject({
            expected_cash: 100
        })
        const { data: expenseRow } = await service()
            .from('expenses')
            .select('voided_after_close')
            .eq('id', expense.data!)
            .single()
        expect(expenseRow?.voided_after_close).toBe(false)
        await closeAnyDay()
    })

    test('B7: an offline card+cash sale never drops the card payment when the cash leg is adjusted to zero', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const sold = await cashier.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_discount: 0,
            p_occurred_at: new Date().toISOString(),
            // Client-declared payments sum to 12 (stale price); the server total is 10. The cash leg (2) must
            // absorb the whole adjustment; the 10 already charged to the card must survive untouched.
            p_payments: [
                { method: 'cash', amount: 2 },
                { method: 'card', amount: 10 }
            ]
        })
        expect(sold.error).toBeNull()
        const { data: payments } = await service()
            .from('payments')
            .select('payment_method, amount')
            .eq('order_id', sold.data!)
            .order('payment_method')
        expect(payments).toEqual([{ payment_method: 'card', amount: 10 }])
        const { data: order } = await service().from('orders').select('sync_issues').eq('id', sold.data!).single()
        // payment_adjusted logs the complete before/after payment arrays, not just the touched scalar.
        expect(order?.sync_issues).toMatchObject({
            payment_adjusted: {
                before: [
                    { method: 'cash', amount: 2 },
                    { method: 'card', amount: 10 }
                ],
                after: [{ method: 'card', amount: 10 }]
            }
        })
    })

    test('B7: two non-cash payments never collapse into one when the excess drains from the last leg', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const sold = await cashier.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_discount: 0,
            p_occurred_at: new Date().toISOString(),
            // Sum is 15 (stale price), server total is 10. Neither leg is cash, so the LAST one (ewallet) drains
            // first; it absorbs the whole -5 adjustment and survives at 5. The card payment must be untouched.
            p_payments: [
                { method: 'card', amount: 7 },
                { method: 'ewallet', amount: 8 }
            ]
        })
        expect(sold.error).toBeNull()
        const { data: payments } = await service()
            .from('payments')
            .select('payment_method, amount')
            .eq('order_id', sold.data!)
            .order('payment_method')
        expect(payments).toEqual([
            { payment_method: 'card', amount: 7 },
            { payment_method: 'ewallet', amount: 3 }
        ])
    })

    // P1-a: see docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md (second-pass adversarial review)
    test('P1-a: two cashiers with two different open tills in the same day can both use /cash without error', async () => {
        await closeAnyDay()
        expect((await cashier.rpc('open_business_day', {})).error).toBeNull()

        const registerA = await registerId()
        const registerB = await service()
            .from('cash_registers')
            .insert({ name: `P1a-${Date.now()}` })
            .select('id')
            .single()
        expect(registerB.error).toBeNull()

        const otherEmail = `${uniq('p1a-cashier')}@barstock.test`
        const otherPassword = 'barstock-test-password-1'
        const created = await service().auth.admin.createUser({
            email: otherEmail,
            password: otherPassword,
            email_confirm: true,
            app_metadata: { role: 'cashier' }
        })
        expect(created.error).toBeNull()
        const otherId = created.data.user!.id
        const otherClient = createClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
        )
        const signIn = await otherClient.auth.signInWithPassword({ email: otherEmail, password: otherPassword })
        expect(signIn.error).toBeNull()

        const sessionA = await cashier.rpc('open_cash_session', {
            p_register_id: registerA,
            p_opening_float: 100,
            p_user_ids: [users.cashier.id]
        })
        expect(sessionA.error).toBeNull()
        const sessionB = await otherClient.rpc('open_cash_session', {
            p_register_id: registerB.data!.id,
            p_opening_float: 200,
            p_user_ids: [otherId]
        })
        expect(sessionB.error).toBeNull()

        // Each cashier reads THEIR OWN session through cash_session_summary without error...
        const ownA = await cashier.rpc('cash_session_summary', { p_session_id: sessionA.data! })
        expect(ownA.error).toBeNull()
        const ownB = await otherClient.rpc('cash_session_summary', { p_session_id: sessionB.data! })
        expect(ownB.error).toBeNull()

        // ...and cashier A's own /cash desk view does not blow up now that a SECOND, unrelated till (B) is open.
        const httpA = await loginAs('cashier')
        const desk = await httpA.get(current, 'business-days/current')
        expect(desk.status).toBe(200)
        const body = dataOf<{ sessions: { id: string; expected_cash: number | null }[] }>(desk)
        expect(body.sessions.map(s => s.id).sort()).toEqual([sessionA.data as string, sessionB.data as string].sort())
        // R-1 (blind cash count) applies to a cashier's OWN till too, not just other people's: neither is shown.
        const mine = body.sessions.find(s => s.id === sessionA.data)
        const theirs = body.sessions.find(s => s.id === sessionB.data)
        expect(mine?.expected_cash).toBeNull()
        expect(theirs?.expected_cash).toBeNull()

        await service().from('cash_sessions').delete().eq('id', sessionB.data!)
        await service().from('cash_sessions').delete().eq('id', sessionA.data!)
        await service().auth.admin.deleteUser(otherId)
        await service().from('cash_registers').delete().eq('id', registerB.data!.id)
        await closeAnyDay()
    })

    // P1-b: cash_session_summary must not leak the components that sum to expected_cash while a cashier's own
    // till is still open — only opening_float may survive.
    test('P1-b: an open till hides every money-derivable component from its own cashier, not just expected_cash', async () => {
        await closeAnyDay()
        expect((await cashier.rpc('open_business_day', {})).error).toBeNull()
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 50,
            p_user_ids: [users.cashier.id]
        })
        expect(session.error).toBeNull()
        const product = await createProduct({ selling_price: 30, tax_rate: 0, stock: 1 })
        expect((await sell(cashier, product.id)).error).toBeNull()

        const summary = await cashier.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(summary.error).toBeNull()
        const keys = Object.keys(summary.data as Record<string, unknown>).sort()
        expect(keys).not.toContain('expected_cash')
        expect(keys).not.toContain('cash_sales')
        expect(keys).not.toContain('open_tab_cash')
        expect(keys).not.toContain('deposits')
        expect(keys).not.toContain('withdrawals')
        expect(keys).not.toContain('refunded_cash')
        expect(keys).not.toContain('expenses')
        expect(keys).not.toContain('purchases')
        expect((summary.data as { opening_float: number }).opening_float).toBe(50)

        // A manager still sees everything live.
        const managerView = await manager.rpc('cash_session_summary', { p_session_id: session.data! })
        expect(managerView.data).toMatchObject({ expected_cash: 80, cash_sales: 30 })
        await closeAnyDay()
    })

    test('B7: create_sale rejects two payments with the same method, matching pay_receivable', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 1 })
        const sold = await cashier.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_discount: 0,
            p_payments: [
                { method: 'cash', amount: 5 },
                { method: 'cash', amount: 5 }
            ]
        })
        expect(sold.error?.code).toBe('P0001')
    })

    test('B5: adjust_business_day rejects a future close and an overlap, and reassigns expenses/purchases/sessions', async () => {
        await closeAnyDay()
        const opened = await cashier.rpc('open_business_day', {})
        expect(opened.error).toBeNull()

        const future = await admin.rpc('adjust_business_day', {
            p_id: opened.data!,
            p_opened_at: new Date(Date.now() - 60_000).toISOString(),
            p_closed_at: new Date(Date.now() + 60_000).toISOString()
        })
        expect(future.error?.code).toBe('P0001')

        // A second, disjoint day far in the past, so an overlap attempt below has something concrete to hit. The
        // offset is randomized (and cleaned up at the end) so a repeat run against the same local DB — this test
        // is not the only place that leaves history around at "N days ago" — cannot collide with a leftover.
        const otherDayId = crypto.randomUUID()
        const anchor = Date.now() - (2_000 + Math.floor(Math.random() * 2_000)) * 24 * 60 * 60 * 1000
        const otherOpen = new Date(anchor).toISOString()
        const otherClose = new Date(anchor + 60 * 60 * 1000).toISOString()
        const otherDay = await service().from('business_days').insert({
            id: otherDayId,
            opened_at: otherOpen,
            closed_at: otherClose,
            close_kind: 'manual',
            opened_by: users.cashier.id
        })
        expect(otherDay.error).toBeNull()

        const overlap = await admin.rpc('adjust_business_day', {
            p_id: opened.data!,
            p_opened_at: new Date(anchor + 30 * 60 * 1000).toISOString(),
            p_closed_at: new Date(anchor + 90 * 60 * 1000).toISOString()
        })
        expect(overlap.error?.code).toBe('P0001')

        // A cash session opened now (real time) cannot itself be moved into the past — cash_sessions.opened_at is
        // not a caller-supplied parameter — so it exercises the NOT NULL fallback (B5 note in the migration): it
        // stays on the day being adjusted rather than being orphaned.
        const session = await cashier.rpc('open_cash_session', {
            p_register_id: await registerId(),
            p_opening_float: 0,
            p_user_ids: [users.cashier.id]
        })
        expect(session.error).toBeNull()

        const newAnchor = Date.now() - (4_000 + Math.floor(Math.random() * 2_000)) * 24 * 60 * 60 * 1000
        const newOpen = new Date(newAnchor).toISOString()
        const newClose = new Date(newAnchor + 60 * 60 * 1000).toISOString()
        // The expense's occurred_at is set inside the day's new (past) window, so it genuinely follows the move.
        const category = await service().from('expense_categories').select('id').eq('name', 'Otros').single()
        const expense = await manager.rpc('create_expense', {
            p_category_id: category.data!.id,
            p_description: 'B5 reassignment test',
            p_amount: 5,
            p_payment_method: 'card',
            p_occurred_at: new Date(newAnchor + 30 * 60 * 1000).toISOString(),
            p_supplier_id: null as unknown as string,
            p_cash_session_id: null as unknown as string
        })
        expect(expense.error).toBeNull()

        const adjusted = await admin.rpc('adjust_business_day', {
            p_id: opened.data!,
            p_opened_at: newOpen,
            p_closed_at: newClose,
            p_notes: 'moved into the past'
        })
        expect(adjusted.error).toBeNull()
        const dayId = opened.data as string

        const { data: expenseRow } = await service()
            .from('expenses')
            .select('business_day_id')
            .eq('id', expense.data!)
            .single()
        expect(expenseRow?.business_day_id).toBe(dayId)
        const { data: sessionRow } = await service()
            .from('cash_sessions')
            .select('business_day_id')
            .eq('id', session.data!)
            .single()
        expect(sessionRow?.business_day_id).toBe(dayId)

        // This day now sits at a fixed offset in the past (for a deterministic, collision-free window) — leaving
        // it behind would collide with the identical window the next run of this same test picks, and it is
        // otherwise invisible to closeAnyDay() (its closed_at is in the past, not null or future). Delete it and
        // everything hung off it outright rather than leaving fabricated history around.
        await service().from('cash_sessions').delete().eq('id', session.data!)
        await service().from('expenses').update({ business_day_id: null }).eq('id', expense.data!)
        await service().from('business_days').delete().eq('id', dayId)
        await service().from('business_days').delete().eq('id', otherDayId)
    })
})
