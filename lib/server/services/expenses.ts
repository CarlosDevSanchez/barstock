import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import type { ExpenseCategoryCreate, ExpenseCreate, ExpensesQuery, ExpenseVoid } from '@/lib/validation/expenses'
import { assertMoneyScale } from './_shared'
import { getSettings } from './settings'

const LIST_SELECT =
    'id, description, amount, payment_method, occurred_at, cash_session_id, category:expense_categories(name)'

export interface ExpenseRow {
    id: string
    description: string
    amount: number
    payment_method: string
    occurred_at: string
    cash_session_id: string | null
    category: string
}

export interface ExpenseList {
    rows: ExpenseRow[]
    total: number
    byCategory: { category: string; total: number }[]
    categories: { id: string; name: string }[]
}

function categoryName(value: { name: string } | { name: string }[] | null): string {
    if (Array.isArray(value)) return value[0]?.name ?? ''
    return value?.name ?? ''
}

/** Midnight of a calendar date in the store time zone, as an ISO instant. */
function startOfZonedDay(isoDate: string, timeZone: string): string {
    const utcMidnight = new Date(`${isoDate}T00:00:00.000Z`)
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(utcMidnight)
    const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value)
    const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second'))
    return new Date(utcMidnight.getTime() - (asUtc - utcMidnight.getTime())).toISOString()
}

function nextDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number)
    return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1)).toISOString().slice(0, 10)
}

export async function listExpenses(supabase: AppSupabaseClient, query: ExpensesQuery): Promise<ExpenseList> {
    const { timezone } = await getSettings(supabase)
    const start = query.from ? startOfZonedDay(query.from, timezone) : null
    const end = query.to ? startOfZonedDay(nextDate(query.to), timezone) : null
    const { from, to } = pageRange(query)

    let rowsQuery = supabase.from('expenses').select(LIST_SELECT, { count: 'exact' }).is('deleted_at', null)
    let sumsQuery = supabase.from('expenses').select('amount, category:expense_categories(name)').is('deleted_at', null)
    if (query.category_id) {
        rowsQuery = rowsQuery.eq('category_id', query.category_id)
        sumsQuery = sumsQuery.eq('category_id', query.category_id)
    }
    if (start) {
        rowsQuery = rowsQuery.gte('occurred_at', start)
        sumsQuery = sumsQuery.gte('occurred_at', start)
    }
    if (end) {
        rowsQuery = rowsQuery.lt('occurred_at', end)
        sumsQuery = sumsQuery.lt('occurred_at', end)
    }

    const [rowsResult, sumsResult, categoriesResult] = await Promise.all([
        rowsQuery.order('occurred_at', { ascending: false }).range(from, to),
        sumsQuery,
        supabase.from('expense_categories').select('id, name').eq('is_active', true).order('name')
    ])
    assertNoError(rowsResult.error)
    assertNoError(sumsResult.error)
    assertNoError(categoriesResult.error)

    const totals = new Map<string, number>()
    for (const row of sumsResult.data ?? []) {
        const name = categoryName(row.category)
        totals.set(name, (totals.get(name) ?? 0) + Number(row.amount))
    }

    return {
        rows: (rowsResult.data ?? []).map(row => ({
            id: row.id,
            description: row.description,
            amount: Number(row.amount),
            payment_method: row.payment_method,
            occurred_at: row.occurred_at,
            cash_session_id: row.cash_session_id,
            category: categoryName(row.category)
        })),
        total: rowsResult.count ?? 0,
        byCategory: [...totals.entries()]
            .map(([category, total]) => ({ category, total }))
            .sort((a, b) => a.category.localeCompare(b.category)),
        categories: categoriesResult.data ?? []
    }
}

export async function createExpense(supabase: AppSupabaseClient, input: ExpenseCreate): Promise<{ id: string }> {
    await assertMoneyScale(supabase, { amount: input.amount })
    const { data, error } = await supabase.rpc('create_expense', {
        p_category_id: input.category_id,
        p_description: input.description,
        p_amount: input.amount,
        p_payment_method: input.payment_method,
        // Generated args are `string` even though the SQL accepts null.
        p_occurred_at: input.occurred_at ?? (null as unknown as string),
        p_supplier_id: input.supplier_id ?? (null as unknown as string),
        p_cash_session_id: input.cash_session_id ?? (null as unknown as string)
    })
    assertNoError(error)
    if (typeof data !== 'string') throw notFound('Expense not found')
    return { id: data }
}

export async function voidExpense(supabase: AppSupabaseClient, id: string, input: ExpenseVoid): Promise<void> {
    const { error } = await supabase.rpc('void_expense', { p_id: id, p_reason: input.reason })
    assertNoError(error)
}

export async function createExpenseCategory(
    supabase: AppSupabaseClient,
    input: ExpenseCategoryCreate
): Promise<{ id: string }> {
    const { data, error } = await supabase.from('expense_categories').insert({ name: input.name }).select('id').single()
    assertNoError(error)
    if (!data) throw notFound('Category not found')
    return { id: data.id }
}
