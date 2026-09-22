import type { ProductListItem, TopProduct } from '@/lib/server/services/products'
import type { ProductCreate, ProductUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { apiDelete, apiGet, apiList, apiPatch, apiPost, type Query } from './client'

export type { ProductListItem, TopProduct }

export const productsApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<ProductListItem>('products', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<Tables<'products'>>(`products/${id}`, undefined, signal),
    create: (body: ProductCreate) => apiPost<Tables<'products'>>('products', body),
    update: (id: string, body: ProductUpdate) => apiPatch<Tables<'products'>>(`products/${id}`, body),
    remove: (id: string) => apiDelete(`products/${id}`),
    top: (query: Query = {}, signal?: AbortSignal) => apiGet<TopProduct[]>('products/top', query, signal)
}
