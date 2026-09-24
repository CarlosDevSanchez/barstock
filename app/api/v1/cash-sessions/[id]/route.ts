import { ok, route } from '@/lib/server/http'
import { getCashSession } from '@/lib/server/services/cash-sessions'
import { idParamsSchema } from '@/lib/validation/common'

export const GET = route({
    role: 'cashier',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getCashSession(supabase, params.id))
})
