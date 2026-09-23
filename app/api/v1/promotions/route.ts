import { created, paginated, route } from '@/lib/server/http'
import { createPromotion, listPromotions } from '@/lib/server/services/promotions'
import { promotionCreateSchema, promotionsQuerySchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    query: promotionsQuerySchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listPromotions(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})

export const POST = route({
    role: 'manager',
    body: promotionCreateSchema,
    handler: async ({ supabase, body }) => created(await createPromotion(supabase, body))
})
