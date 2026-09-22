import { ok, route } from '@/lib/server/http'
import { setTabDiscount } from '@/lib/server/services/tabs'
import { idParamsSchema } from '@/lib/validation/common'
import { setTabDiscountSchema } from '@/lib/validation/tabs'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: setTabDiscountSchema,
    handler: async ({ supabase, params, body }) => ok(await setTabDiscount(supabase, params.id, body))
})
