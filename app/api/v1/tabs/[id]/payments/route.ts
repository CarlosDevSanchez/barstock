import { ok, route } from '@/lib/server/http'
import { payTab } from '@/lib/server/services/tabs'
import { idParamsSchema } from '@/lib/validation/common'
import { payTabSchema } from '@/lib/validation/tabs'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: payTabSchema,
    handler: async ({ supabase, params, body }) => ok(await payTab(supabase, params.id, body))
})
