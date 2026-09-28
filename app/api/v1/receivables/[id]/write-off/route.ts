import { noContent, route } from '@/lib/server/http'
import { writeOffReceivable } from '@/lib/server/services/receivables'
import { idParamsSchema } from '@/lib/validation/common'
import { writeOffReceivableSchema } from '@/lib/validation/receivables'

export const POST = route({
    role: 'admin',
    params: idParamsSchema,
    body: writeOffReceivableSchema,
    handler: async ({ supabase, params, body }) => {
        await writeOffReceivable(supabase, params.id, body)
        return noContent()
    }
})
