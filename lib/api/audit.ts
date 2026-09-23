import type { AuditRow } from '@/lib/server/services/audit'
import { apiList, type Query } from './client'

export type { AuditRow }

export const auditApi = {
    list: (query: Query, signal?: AbortSignal) => apiList<AuditRow>('audit', query, signal)
}
