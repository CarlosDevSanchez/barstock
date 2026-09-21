import type { CategoryListItem } from '@/lib/server/services/categories'
import type { CategoryCreate, CategoryUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { apiDelete, apiList, apiPatch, apiPost, type Query } from './client'

export type { CategoryListItem }

export const categoriesApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<CategoryListItem>('categories', query, signal),
    create: (body: CategoryCreate) => apiPost<Tables<'categories'>>('categories', body),
    update: (id: string, body: CategoryUpdate) => apiPatch<Tables<'categories'>>(`categories/${id}`, body),
    remove: (id: string) => apiDelete(`categories/${id}`)
}
