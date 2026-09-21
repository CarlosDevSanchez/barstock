import { noContent, ok, route } from '@/lib/server/http'
import { deleteProduct, getProduct, updateProduct } from '@/lib/server/services/products'
import { idParamsSchema } from '@/lib/validation/common'
import { productUpdateSchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getProduct(supabase, params.id))
})

export const PATCH = route({
    role: 'manager',
    params: idParamsSchema,
    body: productUpdateSchema,
    handler: async ({ supabase, params, body }) => ok(await updateProduct(supabase, params.id, body))
})

export const DELETE = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => {
        await deleteProduct(supabase, params.id)
        return noContent()
    }
})
