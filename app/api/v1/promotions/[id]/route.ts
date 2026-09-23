import { noContent, ok, route } from '@/lib/server/http'
import { deletePromotion, getPromotion, updatePromotion } from '@/lib/server/services/promotions'
import { idParamsSchema } from '@/lib/validation/common'
import { promotionUpdateSchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getPromotion(supabase, params.id))
})

export const PATCH = route({
    role: 'manager',
    params: idParamsSchema,
    body: promotionUpdateSchema,
    handler: async ({ supabase, params, body }) => ok(await updatePromotion(supabase, params.id, body))
})

export const DELETE = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => {
        await deletePromotion(supabase, params.id)
        return noContent()
    }
})
