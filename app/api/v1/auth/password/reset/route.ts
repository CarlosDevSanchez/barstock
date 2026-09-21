import { noContent, route } from '@/lib/server/http'
import { setPassword } from '@/lib/server/services/auth'
import { resetPasswordSchema } from '@/lib/validation/resources'

export const POST = route({
    role: 'cashier',
    body: resetPasswordSchema,
    handler: async ({ supabase, body }) => {
        await setPassword(supabase, body.password)
        return noContent()
    }
})
