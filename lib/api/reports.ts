import type { DashboardSummary, SalesReport } from '@/lib/validation/reports'
import { apiGet } from './client'

export type { DashboardSummary, SalesReport }

export const dashboardApi = {
    get: (signal?: AbortSignal) => apiGet<DashboardSummary>('dashboard', undefined, signal)
}

export const reportsApi = {
    get: (range: { from: string; to: string }, signal?: AbortSignal) => apiGet<SalesReport>('reports', range, signal)
}
