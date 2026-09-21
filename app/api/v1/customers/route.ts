import { created, paginated, route } from '@/lib/server/http'
import { createCustomer, listCustomers } from '@/lib/server/services/customers'
import { paginationSchema } from '@/lib/validation/common'
import { customerCreateSchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    query: paginationSchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listCustomers(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})

export const POST = route({
    role: 'cashier',
    body: customerCreateSchema,
    handler: async ({ supabase, body }) => created(await createCustomer(supabase, body))
})
