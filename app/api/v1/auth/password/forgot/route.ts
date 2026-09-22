import { noContent, publicRoute } from '@/lib/server/http'
import { requestPasswordReset } from '@/lib/server/services/auth'
import { forgotPasswordSchema } from '@/lib/validation/resources'

export const POST = publicRoute({
    body: forgotPasswordSchema,
    handler: async ({ supabase, body }) => {
        await requestPasswordReset(supabase, body.email)
        return noContent()
    }
})
