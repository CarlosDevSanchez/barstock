import { ok, route } from '@/lib/server/http'
import { addTabMembers } from '@/lib/server/services/tabs'
import { idParamsSchema } from '@/lib/validation/common'
import { addTabMembersSchema } from '@/lib/validation/tabs'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: addTabMembersSchema,
    handler: async ({ supabase, params, body }) => ok(await addTabMembers(supabase, params.id, body))
})
