import { created, paginated, route } from '@/lib/server/http'
import { createCategory, listCategories } from '@/lib/server/services/categories'
import { paginationSchema } from '@/lib/validation/common'
import { categoryCreateSchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    query: paginationSchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listCategories(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})

export const POST = route({
    role: 'manager',
    body: categoryCreateSchema,
    handler: async ({ supabase, body }) => created(await createCategory(supabase, body))
})
