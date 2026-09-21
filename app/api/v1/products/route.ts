import { created, paginated, route } from '@/lib/server/http'
import { createProduct, listProducts } from '@/lib/server/services/products'
import { productCreateSchema, productsQuerySchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    query: productsQuerySchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listProducts(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})

export const POST = route({
    role: 'manager',
    body: productCreateSchema,
    handler: async ({ supabase, body }) => created(await createProduct(supabase, body))
})
