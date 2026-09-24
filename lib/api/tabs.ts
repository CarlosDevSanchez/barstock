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
    pay: (id: string, body: PayTabInput) => apiPost<TabDetail>(`tabs/${id}/payments`, body),
    paySplit: (id: string, body: PayTabSplitInput) => apiPost<TabDetail>(`tabs/${id}/payments`, body),
    void: (id: string, body: VoidTabInput) => apiPost<TabDetail>(`tabs/${id}/void`, body)
}
