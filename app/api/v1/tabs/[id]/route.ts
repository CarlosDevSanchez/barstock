import { ok, route } from '@/lib/server/http'
import { getTab } from '@/lib/server/services/tabs'
import { idParamsSchema } from '@/lib/validation/common'

export const GET = route({
    role: 'cashier',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getTab(supabase, params.id))
})
