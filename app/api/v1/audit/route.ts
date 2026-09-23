import { paginated, route } from '@/lib/server/http'
import { listAudit } from '@/lib/server/services/audit'
import { auditQuerySchema } from '@/lib/validation/resources'

// Read-only: no POST/PATCH/DELETE. Writes to audit_log happen only through the DB triggers and log_auth_event.
export const GET = route({
    role: 'admin',
    query: auditQuerySchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listAudit(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})
