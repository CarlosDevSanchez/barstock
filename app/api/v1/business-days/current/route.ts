import { ok, route } from '@/lib/server/http'
import { getCashDesk } from '@/lib/server/services/cash-sessions'

export const GET = route({
    role: 'cashier',
    handler: async ({ supabase, user }) => ok(await getCashDesk(supabase, user))
})
