import { ok, route } from '@/lib/server/http'
import { deferTab } from '@/lib/server/services/receivables'
import { idParamsSchema } from '@/lib/validation/common'
import { deferTabSchema } from '@/lib/validation/receivables'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: deferTabSchema,
    handler: async ({ supabase, params, body }) => ok(await deferTab(supabase, params.id, body))
})
