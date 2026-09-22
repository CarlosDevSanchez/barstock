import type { ProductDetail, ProductListItem, TopProduct } from '@/lib/server/services/products'
import type { ProductCreate, ProductUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { apiDelete, apiGet, apiList, apiPatch, apiPost, apiPostForm, type Query } from './client'

export type { ProductDetail, ProductListItem, TopProduct }

export const productsApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<ProductListItem>('products', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<ProductDetail>(`products/${id}`, undefined, signal),
    create: (body: ProductCreate) => apiPost<Tables<'products'>>('products', body),
    update: (id: string, body: ProductUpdate) => apiPatch<Tables<'products'>>(`products/${id}`, body),
    remove: (id: string) => apiDelete(`products/${id}`),
    top: (query: Query = {}, signal?: AbortSignal) => apiGet<TopProduct[]>('products/top', query, signal),
    uploadImage: (id: string, file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        return apiPostForm<{ image_url: string }>(`products/${id}/image`, formData)
    },
    deleteImage: (id: string) => apiDelete<{ image_url: null }>(`products/${id}/image`)
}
