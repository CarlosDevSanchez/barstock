import type { OrderDetail, OrderListItem } from '@/lib/server/services/orders'
import type { SaleInput } from '@/lib/validation/resources'
import { apiGet, apiList, apiPost, type Query } from './client'

export type { OrderDetail, OrderListItem }

export const ordersApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<OrderListItem>('orders', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<OrderDetail>(`orders/${id}`, undefined, signal),
    refund: (id: string, reason: string) => apiPost<OrderDetail>(`orders/${id}/refund`, { reason })
}

export const salesApi = {
    /**
     * `idempotencyKey` lets the caller retry a checkout attempt (network drop, a lost response) without risking a
     * duplicate charge: the server returns the same order for a replay of the same key. See create_sale (F0,
     * docs/06-roadmap/offline-y-sincronizacion.md).
     */
    create: (body: SaleInput, idempotencyKey?: string) =>
        apiPost<OrderDetail>('sales', body, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined)
}
