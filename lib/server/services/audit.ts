import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import type { AuditQuery } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import type { Page } from './_shared'

export type AuditRow = Tables<'audit_log'>

/**
 * Admin-only, read-only. RLS already restricts rows to admins (`audit_log_select`): this is the same guarantee the
 * `route({ role: 'admin' })` guard on the endpoint gives, kept as defense in depth.
 */
export async function listAudit(
    supabase: AppSupabaseClient,
    { page, pageSize, actor_id, action, entity, from: dateFrom, to: dateTo }: AuditQuery
): Promise<Page<AuditRow>> {
    let query = supabase
        .from('audit_log')
        .select('*', { count: 'exact' })
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
    if (actor_id) query = query.eq('actor_id', actor_id)
    if (action) query = query.eq('action', action)
    if (entity) query = query.eq('entity', entity)
    if (dateFrom) query = query.gte('occurred_at', `${dateFrom}T00:00:00Z`)
    if (dateTo) query = query.lte('occurred_at', `${dateTo}T23:59:59.999Z`)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)
    return { rows: data, total: count ?? 0 }
}
