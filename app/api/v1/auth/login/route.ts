import { ok, publicRoute } from '@/lib/server/http'
import { signIn } from '@/lib/server/services/auth'
import { loginSchema } from '@/lib/validation/resources'

export const POST = publicRoute({
    body: loginSchema,
    handler: async ({ supabase, body }) => ok(await signIn(supabase, body.email, body.password))
})
