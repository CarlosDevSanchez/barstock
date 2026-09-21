import { ok, route } from '@/lib/server/http'
import { getSalesReport } from '@/lib/server/services/reports'
import { reportQuerySchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'manager',
    query: reportQuerySchema,
    handler: async ({ supabase, query }) => ok(await getSalesReport(supabase, query.from, query.to))
})
