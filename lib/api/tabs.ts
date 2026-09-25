import type { TabDetail, TabListItem } from '@/lib/server/services/tabs'
import type {
    AddTabItemsInput,
    AddTabMembersInput,
    OpenTabInput,
    PayTabInput,
    PayTabSplitInput,
    RemoveTabItemInput,
    SetTabDiscountInput,
    VoidTabInput
} from '@/lib/validation/tabs'
import type { DeferTabInput } from '@/lib/validation/receivables'
import type { OrderDetail } from '@/lib/api/orders'
import { apiDelete, apiGet, apiList, apiPost, type Query } from './client'

export type { TabDetail, TabListItem }

export const tabsApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<TabListItem>('tabs', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<TabDetail>(`tabs/${id}`, undefined, signal),
    open: (body: OpenTabInput) => apiPost<TabDetail>('tabs', body),
    addMembers: (id: string, body: AddTabMembersInput) => apiPost<TabDetail>(`tabs/${id}/members`, body),
    addItems: (id: string, body: AddTabItemsInput) => apiPost<TabDetail>(`tabs/${id}/items`, body),
    removeItem: (id: string, itemId: string, body: RemoveTabItemInput) =>
        apiDelete<TabDetail>(`tabs/${id}/items/${itemId}`, body),
    setDiscount: (id: string, body: SetTabDiscountInput) => apiPost<TabDetail>(`tabs/${id}/discount`, body),
    pay: (id: string, body: PayTabInput, idempotencyKey?: string) =>
        apiPost<TabDetail>(`tabs/${id}/payments`, body, {
            headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
        }),
    paySplit: (id: string, body: PayTabSplitInput, idempotencyKey?: string) =>
        apiPost<TabDetail>(`tabs/${id}/payments`, body, {
            headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
        }),
    void: (id: string, body: VoidTabInput) => apiPost<TabDetail>(`tabs/${id}/void`, body),
    /** Close an open tab as a pending receivable. Idempotency-Key is required. */
    defer: (id: string, body: DeferTabInput, idempotencyKey: string) =>
        apiPost<OrderDetail>(`tabs/${id}/defer`, body, {
            headers: { 'Idempotency-Key': idempotencyKey }
        })
}
