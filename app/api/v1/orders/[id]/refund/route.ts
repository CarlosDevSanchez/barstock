import { ok, route } from '@/lib/server/http'
import { refundOrder } from '@/lib/server/services/orders'
import { idParamsSchema } from '@/lib/validation/common'
import { refundSchema } from '@/lib/validation/resources'

export const POST = route({
    role: 'manager',
    params: idParamsSchema,
    body: refundSchema,
    handler: async ({ supabase, params, body }) => ok(await refundOrder(supabase, params.id, body.reason))
})
