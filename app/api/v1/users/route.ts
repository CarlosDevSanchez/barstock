import { paginated, route } from '@/lib/server/http'
import { listUsers } from '@/lib/server/services/users'
import { paginationSchema } from '@/lib/validation/common'

export const GET = route({
    role: 'admin',
    query: paginationSchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listUsers(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})
