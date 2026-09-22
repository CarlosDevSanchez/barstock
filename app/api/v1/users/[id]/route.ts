import { ok, route } from '@/lib/server/http'
import { updateUser } from '@/lib/server/services/users'
import { idParamsSchema } from '@/lib/validation/common'
import { updateUserSchema } from '@/lib/validation/resources'

export const PATCH = route({
    role: 'admin',
    params: idParamsSchema,
    body: updateUserSchema,
    handler: async ({ supabase, user, params, body }) => ok(await updateUser(supabase, user.id, params.id, body))
})
