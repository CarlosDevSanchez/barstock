import { ok, route } from '@/lib/server/http'
import { payTab, payTabSplit } from '@/lib/server/services/tabs'
import { idParamsSchema } from '@/lib/validation/common'
import { payTabBodySchema } from '@/lib/validation/tabs'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: payTabBodySchema,
    handler: async ({ supabase, params, body }) =>
        ok('payments' in body ? await payTabSplit(supabase, params.id, body) : await payTab(supabase, params.id, body))
})
