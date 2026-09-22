import type { CustomerCreate, CustomerUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { apiGet, apiList, apiPatch, apiPost, type Query } from './client'

export const customersApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<Tables<'customers'>>('customers', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<Tables<'customers'>>(`customers/${id}`, undefined, signal),
    create: (body: CustomerCreate) => apiPost<Tables<'customers'>>('customers', body),
    update: (id: string, body: CustomerUpdate) => apiPatch<Tables<'customers'>>(`customers/${id}`, body)
}
