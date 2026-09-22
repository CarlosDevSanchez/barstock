import { ok, route } from '@/lib/server/http'
import { listTopProducts } from '@/lib/server/services/products'
import { topProductsQuerySchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    query: topProductsQuerySchema,
    handler: async ({ supabase, query }) => ok(await listTopProducts(supabase, query.days, query.limit))
})
