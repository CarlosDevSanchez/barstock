import { apiDelete, apiGet, apiPost } from './client'
import type { ExpenseCreate } from '@/lib/validation/expenses'

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

export const expensesApi = {
    list: (query: { from?: string; to?: string; category_id?: string; page?: number }, signal?: AbortSignal) =>
        apiGet<ExpenseList>('expenses', query, signal),
    create: (body: ExpenseCreate) => apiPost<{ id: string }>('expenses', body),
    void: (id: string, reason: string) => apiDelete(`expenses/${id}`, { reason })
}
