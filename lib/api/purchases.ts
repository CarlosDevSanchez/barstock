import { apiDelete, apiPost } from './client'
import type { PurchaseReceive } from '@/lib/validation/purchases'

export const purchasesApi = {
    receive: (body: PurchaseReceive) => apiPost<{ id: string }>('purchases', body),
    void: (id: string, reason: string) => apiDelete(`purchases/${id}`, { reason })
}
