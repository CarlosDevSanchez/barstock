import { ok, route } from '@/lib/server/http'
import { listReceivables } from '@/lib/server/services/receivables'
import { listReceivablesQuerySchema } from '@/lib/validation/receivables'

export const GET = route({
    role: 'cashier',
    query: listReceivablesQuerySchema,
    handler: async ({ supabase, query }) => ok(await listReceivables(supabase, query))
})
