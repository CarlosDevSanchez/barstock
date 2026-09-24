import { noContent, route } from '@/lib/server/http'
import { updateReceivable } from '@/lib/server/services/receivables'
import { idParamsSchema } from '@/lib/validation/common'
import { updateReceivableSchema } from '@/lib/validation/receivables'

export const PATCH = route({
    role: 'manager',
    params: idParamsSchema,
    body: updateReceivableSchema,
    handler: async ({ supabase, params, body }) => {
        await updateReceivable(supabase, params.id, body)
        return noContent()
    }
})
