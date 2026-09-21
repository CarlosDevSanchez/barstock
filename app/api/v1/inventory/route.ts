import { paginated, route } from '@/lib/server/http'
import { listInventory } from '@/lib/server/services/inventory'
import { inventoryQuerySchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    query: inventoryQuerySchema,
    handler: async ({ supabase, query }) => {
        const { rows, total, summary } = await listInventory(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total }, { ...summary })
    }
})
