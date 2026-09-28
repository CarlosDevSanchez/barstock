import type { OrderDetail, OrderListItem } from '@/lib/server/services/orders'
import type { SaleInput } from '@/lib/validation/resources'
import { apiGet, apiList, apiPatch, apiPost, type Query } from './client'

export type { OrderDetail, OrderListItem }

export const ordersApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<OrderListItem>('orders', query, signal),
    get: (id: string, signal?: AbortSignal) => apiGet<OrderDetail>(`orders/${id}`, undefined, signal),
    refund: (id: string, reason: string) => apiPost<OrderDetail>(`orders/${id}/refund`, { reason }),
    /** Manager review of an offline sale that synced with a difference (F4): stock/price/time clamp. */
    review: (id: string) => apiPatch<OrderDetail>(`orders/${id}/review`, undefined)
}

export const salesApi = {
    /**
     * `idempotencyKey` lets the caller retry a checkout attempt (network drop, a lost response) without risking a
     * duplicate charge: the server returns the same order for a replay of the same key. See create_sale (F0,
     * docs/06-roadmap/offline-y-sincronizacion.md).
     *
     * `redirectOnUnauthorized: false` is used by the offline sync engine (lib/offline/sync.ts): a 401 there pauses
     * that one queued sale instead of navigating the whole tab to /login.
     */
    create: (body: SaleInput, idempotencyKey?: string, options?: { redirectOnUnauthorized?: boolean }) =>
        apiPost<OrderDetail>('sales', body, {
            headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
            redirectOnUnauthorized: options?.redirectOnUnauthorized
        })
}
