import { ok, route } from '@/lib/server/http'
import { voidTab } from '@/lib/server/services/tabs'
import { idParamsSchema } from '@/lib/validation/common'
import { voidTabSchema } from '@/lib/validation/tabs'

export const POST = route({
    role: 'manager',
    params: idParamsSchema,
    body: voidTabSchema,
    handler: async ({ supabase, params, body }) => ok(await voidTab(supabase, params.id, body))
})
