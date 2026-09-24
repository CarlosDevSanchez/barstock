import type { SupplierCreate, SupplierUpdate } from '@/lib/validation/resources'
import type { SupplierPurchaseHistory } from '@/lib/server/services/purchases'
import type { Tables } from '@/types/database'
import { apiDelete, apiGet, apiList, apiPatch, apiPost, type Query } from './client'

export type { SupplierPurchaseHistory }

export const suppliersApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<Tables<'suppliers'>>('suppliers', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<Tables<'suppliers'>>(`suppliers/${id}`, undefined, signal),
    create: (body: SupplierCreate) => apiPost<Tables<'suppliers'>>('suppliers', body),
    update: (id: string, body: SupplierUpdate) => apiPatch<Tables<'suppliers'>>(`suppliers/${id}`, body),
    remove: (id: string) => apiDelete(`suppliers/${id}`),
    history: (id: string, query: { from: string; to: string }, signal?: AbortSignal) =>
        apiGet<SupplierPurchaseHistory>(`suppliers/${id}/history`, query, signal)
}
