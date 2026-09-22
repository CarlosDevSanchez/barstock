import { ok, route } from '@/lib/server/http'
import { getSupplier, updateSupplier } from '@/lib/server/services/suppliers'
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
