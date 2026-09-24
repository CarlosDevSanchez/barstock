import { ok, route } from '@/lib/server/http'
import { reviewOrder } from '@/lib/server/services/orders'
import { idParamsSchema } from '@/lib/validation/common'

export const PATCH = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await reviewOrder(supabase, params.id))
})
