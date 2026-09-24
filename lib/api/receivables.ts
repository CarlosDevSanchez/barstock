import type {
    ListReceivablesQuery,
    PayReceivableInput,
    ReceivableRow,
    UpdateReceivableInput,
    WriteOffReceivableInput
} from '@/lib/validation/receivables'
import { apiGet, apiPatch, apiPost, type Query } from './client'

export type { ReceivableRow }

export const receivablesApi = {
    list: (query?: ListReceivablesQuery, signal?: AbortSignal) =>
        apiGet<ReceivableRow[]>('receivables', query as Query | undefined, signal),
    pay: (id: string, body: PayReceivableInput, idempotencyKey?: string) =>
        apiPost<{ balance: number; status: string }>(`receivables/${id}/payments`, body, {
            headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
        }),
    update: (id: string, body: UpdateReceivableInput) => apiPatch<void>(`receivables/${id}`, body),
    writeOff: (id: string, body: WriteOffReceivableInput) => apiPost<void>(`receivables/${id}/write-off`, body)
}
