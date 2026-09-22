import type { InventoryListItem, InventorySummary } from '@/lib/server/services/inventory'
import { apiList, apiPost, type Query } from './client'

export type { InventoryListItem, InventorySummary }

export const inventoryApi = {
    list: (query: Query, signal?: AbortSignal) =>
        apiList<InventoryListItem, InventorySummary>('inventory', query, signal),
    adjust: (id: string, body: { delta: number; reason: string }) =>
        apiPost<{ quantity: number }>(`inventory/${id}/adjust`, body)
}
