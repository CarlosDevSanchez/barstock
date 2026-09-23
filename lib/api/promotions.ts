import type { PromotionListItem } from '@/lib/server/services/promotions'
import type { PromotionCreate, PromotionUpdate } from '@/lib/validation/resources'
import { apiDelete, apiGet, apiList, apiPatch, apiPost, type Query } from './client'

export type { PromotionListItem }

export const promotionsApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<PromotionListItem>('promotions', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<PromotionListItem>(`promotions/${id}`, undefined, signal),
    create: (body: PromotionCreate) => apiPost<PromotionListItem>('promotions', body),
    update: (id: string, body: PromotionUpdate) => apiPatch<PromotionListItem>(`promotions/${id}`, body),
    remove: (id: string) => apiDelete(`promotions/${id}`)
}
