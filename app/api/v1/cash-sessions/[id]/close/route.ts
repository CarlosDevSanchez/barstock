import { noContent, route } from '@/lib/server/http'
import { closeCashSession } from '@/lib/server/services/cash-sessions'
import { idParamsSchema } from '@/lib/validation/common'
import { closeCashSessionSchema } from '@/lib/validation/cash'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: closeCashSessionSchema,
    handler: async ({ supabase, params, body }) => {
        await closeCashSession(supabase, params.id, body)
        return noContent()
    }
})
