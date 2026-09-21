import { created, paginated, route } from '@/lib/server/http'
import { createSupplier, listSuppliers } from '@/lib/server/services/suppliers'
import { paginationSchema } from '@/lib/validation/common'
import { supplierCreateSchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'manager',
    query: paginationSchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listSuppliers(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})

export const POST = route({
    role: 'manager',
    body: supplierCreateSchema,
    handler: async ({ supabase, body }) => created(await createSupplier(supabase, body))
})
