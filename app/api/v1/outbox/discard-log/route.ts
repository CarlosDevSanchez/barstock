import { noContent, route } from '@/lib/server/http'
import { logOutboxDiscard } from '@/lib/server/services/audit'
import { outboxDiscardSchema } from '@/lib/validation/resources'

export const POST = route({
    role: 'manager',
    body: outboxDiscardSchema,
    handler: async ({ supabase, body }) => {
        await logOutboxDiscard(supabase, body)
        return noContent()
    }
})
