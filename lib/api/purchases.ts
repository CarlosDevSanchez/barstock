import { apiDelete, apiPost } from './client'
import type { PurchaseReceive } from '@/lib/validation/purchases'

export const purchasesApi = {
    receive: (body: PurchaseReceive, idempotencyKey: string) =>
        apiPost<{ id: string }>('purchases', body, { headers: { 'Idempotency-Key': idempotencyKey } }),
    void: (id: string, reason: string) => apiDelete(`purchases/${id}`, { reason })
}
