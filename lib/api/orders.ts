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
    create: (body: SaleInput) => apiPost<OrderDetail>('sales', body)
}
