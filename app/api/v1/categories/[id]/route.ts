import { noContent, ok, route } from '@/lib/server/http'
import { deleteCategory, updateCategory } from '@/lib/server/services/categories'
import { idParamsSchema } from '@/lib/validation/common'
import { categoryUpdateSchema } from '@/lib/validation/resources'

export const PATCH = route({
    role: 'manager',
    params: idParamsSchema,
    body: categoryUpdateSchema,
    handler: async ({ supabase, params, body }) => ok(await updateCategory(supabase, params.id, body))
})

export const DELETE = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => {
        await deleteCategory(supabase, params.id)
        return noContent()
    }
})
