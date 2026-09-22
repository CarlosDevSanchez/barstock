import { ok, route } from '@/lib/server/http'
import { getCustomer, updateCustomer } from '@/lib/server/services/customers'
import { idParamsSchema } from '@/lib/validation/common'
import { customerUpdateSchema } from '@/lib/validation/resources'

export const GET = route({
    role: 'cashier',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getCustomer(supabase, params.id))
})

export const PATCH = route({
    role: 'cashier',
    params: idParamsSchema,
    body: customerUpdateSchema,
    handler: async ({ supabase, params, body }) => ok(await updateCustomer(supabase, params.id, body))
})
