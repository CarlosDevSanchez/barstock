import { ok, route } from '@/lib/server/http'
import { getOrder } from '@/lib/server/services/orders'
import { idParamsSchema } from '@/lib/validation/common'

export const GET = route({
    role: 'cashier',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getOrder(supabase, params.id))
})
