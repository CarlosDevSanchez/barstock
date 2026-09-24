import { created, route } from '@/lib/server/http'
import { openCashSession } from '@/lib/server/services/cash-sessions'
import { openCashSessionSchema } from '@/lib/validation/cash'

export const POST = route({
    role: 'cashier',
    body: openCashSessionSchema,
    handler: async ({ supabase, body }) => created(await openCashSession(supabase, body))
})
