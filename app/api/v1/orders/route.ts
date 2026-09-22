import { paginated, route } from '@/lib/server/http'
import { listOrders } from '@/lib/server/services/orders'
import { ordersQuerySchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    query: ordersQuerySchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listOrders(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})
