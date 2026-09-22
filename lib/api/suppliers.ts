import type { SupplierCreate, SupplierUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { apiList, apiPatch, apiPost, type Query } from './client'

export const suppliersApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<Tables<'suppliers'>>('suppliers', query, signal),
    create: (body: SupplierCreate) => apiPost<Tables<'suppliers'>>('suppliers', body),
    update: (id: string, body: SupplierUpdate) => apiPatch<Tables<'suppliers'>>(`suppliers/${id}`, body)
}
