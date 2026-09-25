import type { BusinessDayReport } from '@/lib/validation/cash'
import { apiGet, apiPatch, apiPost } from './client'

export interface BusinessDay {
    id: string
    opened_at: string
    closed_at: string | null
    close_kind: string | null
    needs_review: boolean
    notes: string | null
    opened_by: string
    closed_by: string | null
    reviewed_at: string | null
    reviewed_by: string | null
}

export interface DeskSession {
    id: string
    register_id: string
    register_name: string
    opening_float: number
    /** R-1: blind cash count. Null while open, for a cashier — manager+ and closed sessions always get a number. */
    expected_cash: number | null
    users: { id: string; full_name: string | null }[]
    movements: { id: string; kind: string; amount: number; reason: string; created_at: string }[]
}

export interface CloseCashSessionResult {
    expected_cash: number
    counted_cash: number
    difference: number
    needs_review: boolean
}

export interface CashDesk {
    day: BusinessDay | null
    sessions: DeskSession[]
    registers: { id: string; name: string; is_active: boolean }[]
    staff: { id: string; full_name: string | null }[]
    default_opening_float: number
}

export type { BusinessDayReport }

export const cashApi = {
    current: (signal?: AbortSignal) => apiGet<CashDesk>('business-days/current', undefined, signal),
    listDays: (needsReview?: boolean, signal?: AbortSignal) =>
        apiGet<BusinessDay[]>(
            'business-days',
            needsReview === undefined ? undefined : { needs_review: needsReview },
            signal
        ),
    report: (id: string, signal?: AbortSignal) => apiGet<BusinessDayReport>(`business-days/${id}`, undefined, signal),
    openDay: () => apiPost<BusinessDay>('business-days', {}),
    closeDay: (id: string) => apiPost<BusinessDay>(`business-days/${id}/close`, {}),
    adjustDay: (id: string, body: { opened_at: string; closed_at: string | null; notes?: string | null }) =>
        apiPatch<BusinessDay>(`business-days/${id}`, body),
    openSession: (body: { register_id: string; opening_float: number; user_ids: string[] }) =>
        apiPost<{ id: string }>('cash-sessions', body),
    addMovement: (id: string, body: { kind: 'deposit' | 'withdrawal'; amount: number; reason: string }) =>
        apiPost<{ id: string }>(`cash-sessions/${id}/movements`, body),
    closeSession: (id: string, body: { counted_cash: number }) =>
        apiPost<CloseCashSessionResult>(`cash-sessions/${id}/close`, body)
}
