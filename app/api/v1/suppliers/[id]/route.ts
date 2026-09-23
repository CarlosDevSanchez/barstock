import { noContent, ok, route } from '@/lib/server/http'
import { deleteSupplier, getSupplier, updateSupplier } from '@/lib/server/services/suppliers'
import { idParamsSchema } from '@/lib/validation/common'
import { supplierUpdateSchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getSupplier(supabase, params.id))
})

export const PATCH = route({
    role: 'manager',
    params: idParamsSchema,
    body: supplierUpdateSchema,
    handler: async ({ supabase, params, body }) => ok(await updateSupplier(supabase, params.id, body))
})

export const DELETE = route({
    role: 'admin',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => {
        await deleteSupplier(supabase, params.id)
        return noContent()
    }
})
