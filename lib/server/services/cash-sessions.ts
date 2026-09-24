import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import type { CashMovementInput, CloseCashSessionInput, OpenCashSessionInput } from '@/lib/validation/cash'
import { assertMoneyScale } from './_shared'
import type { Json, Tables } from '@/types/database'

export interface DeskSession {
    id: string
    register_id: string
    register_name: string
    opening_float: number
    expected_cash: number
    users: { id: string; full_name: string | null }[]
    movements: { id: string; kind: string; amount: number; reason: string; created_at: string }[]
}

export interface CashDesk {
    day: Tables<'business_days'> | null
    sessions: DeskSession[]
    registers: Pick<Tables<'cash_registers'>, 'id' | 'name' | 'is_active'>[]
    staff: { id: string; full_name: string | null }[]
    default_opening_float: number
}

function settingNumber(rows: { key: string; value: Json }[] | null, key: string): number {
    const raw = rows?.find(row => row.key === key)?.value
    return typeof raw === 'number' ? raw : 0
}

/** Closes a day left open more than 24h, then returns the till the cashier is looking at. */
export async function getCashDesk(supabase: AppSupabaseClient): Promise<CashDesk> {
    const { error: refreshError } = await supabase.rpc('refresh_business_days')
    assertNoError(refreshError)

    const [dayResult, registerResult, staffResult, settingsResult] = await Promise.all([
        supabase.from('business_days').select('*').is('closed_at', null).maybeSingle(),
        supabase.from('cash_registers').select('id, name, is_active').order('name'),
        supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
        supabase.from('settings').select('key, value').in('key', ['default_opening_float', 'cash_count_tolerance'])
    ])
    assertNoError(dayResult.error)
    assertNoError(registerResult.error)
    assertNoError(staffResult.error)
    assertNoError(settingsResult.error)

    const day = dayResult.data
    const sessions: DeskSession[] = []
    if (day) {
        const { data: openSessions, error } = await supabase
            .from('cash_sessions')
            .select('id, register_id, opening_float')
            .eq('business_day_id', day.id)
            .eq('status', 'open')
            .order('opened_at')
        assertNoError(error)
        const ids = (openSessions ?? []).map(session => session.id)
        const [links, movements, names] = await Promise.all([
            ids.length
                ? supabase.from('cash_session_users').select('session_id, user_id').in('session_id', ids)
                : Promise.resolve({ data: [], error: null }),
            ids.length
                ? supabase
                      .from('cash_movements')
                      .select('id, session_id, kind, amount, reason, created_at')
                      .in('session_id', ids)
                      .order('created_at')
                : Promise.resolve({ data: [], error: null }),
            Promise.resolve({ data: registerResult.data, error: null })
        ])
        assertNoError(links.error)
        assertNoError(movements.error)
        const staffById = new Map((staffResult.data ?? []).map(person => [person.id, person.full_name]))
        for (const session of openSessions ?? []) {
            const { data: summary, error: summaryError } = await supabase.rpc('cash_session_summary', {
                p_session_id: session.id
            })
            assertNoError(summaryError)
            const expected =
                summary && typeof summary === 'object' && !Array.isArray(summary) ? summary.expected_cash : 0
            const registerName = names.data?.find(register => register.id === session.register_id)?.name ?? ''
            sessions.push({
                id: session.id,
                register_id: session.register_id,
                register_name: registerName,
                opening_float: session.opening_float,
                expected_cash: typeof expected === 'number' ? expected : 0,
                users: (links.data ?? [])
                    .filter(link => link.session_id === session.id)
                    .map(link => ({ id: link.user_id, full_name: staffById.get(link.user_id) ?? null })),
                movements: (movements.data ?? [])
                    .filter(movement => movement.session_id === session.id)
                    .map(movement => ({
                        id: movement.id,
                        kind: movement.kind,
                        amount: movement.amount,
                        reason: movement.reason,
                        created_at: movement.created_at
                    }))
            })
        }
    }

    return {
        day,
        sessions,
        registers: registerResult.data ?? [],
        staff: staffResult.data ?? [],
        default_opening_float: settingNumber(settingsResult.data, 'default_opening_float')
    }
}

export async function listRegisters(supabase: AppSupabaseClient) {
    const { data, error } = await supabase.from('cash_registers').select('id, name, is_active').order('name')
    assertNoError(error)
    return data ?? []
}

export async function createRegister(supabase: AppSupabaseClient, name: string) {
    const { data, error } = await supabase
        .from('cash_registers')
        .insert({ name })
        .select('id, name, is_active')
        .single()
    assertNoError(error)
    return data
}

export async function openCashSession(supabase: AppSupabaseClient, input: OpenCashSessionInput) {
    await assertMoneyScale(supabase, { opening_float: input.opening_float })
    const { data, error } = await supabase.rpc('open_cash_session', {
        p_register_id: input.register_id,
        p_opening_float: input.opening_float,
        p_user_ids: input.user_ids
    })
    assertNoError(error)
    if (!data) throw notFound('Cash session not found')
    return { id: data }
}

export async function getCashSession(supabase: AppSupabaseClient, id: string) {
    const { data, error } = await supabase.rpc('cash_session_summary', { p_session_id: id })
    assertNoError(error)
    if (!data) throw notFound('Cash session not found')
    return data
}

export async function addCashMovement(supabase: AppSupabaseClient, id: string, input: CashMovementInput) {
    await assertMoneyScale(supabase, { amount: input.amount })
    const { data, error } = await supabase.rpc('add_cash_movement', {
        p_session_id: id,
        p_kind: input.kind,
        p_amount: input.amount,
        p_reason: input.reason
    })
    assertNoError(error)
    if (!data) throw notFound('Cash movement not found')
    return { id: data }
}

export async function closeCashSession(supabase: AppSupabaseClient, id: string, input: CloseCashSessionInput) {
    await assertMoneyScale(supabase, { counted_cash: input.counted_cash })
    const { error } = await supabase.rpc('close_cash_session', {
        p_session_id: id,
        p_counted_cash: input.counted_cash,
        p_notes: input.notes ?? undefined
    })
    assertNoError(error)
}
