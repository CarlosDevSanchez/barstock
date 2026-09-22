import { created, route } from '@/lib/server/http'
import { inviteUser } from '@/lib/server/services/users'
import { inviteUserSchema } from '@/lib/validation/resources'

export const POST = route({
    role: 'admin',
    body: inviteUserSchema,
    handler: async ({ supabase, body }) => created(await inviteUser(supabase, body))
})
