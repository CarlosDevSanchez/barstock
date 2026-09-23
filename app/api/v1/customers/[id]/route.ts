import { noContent, ok, route } from '@/lib/server/http'
import { deleteCustomer, getCustomer, updateCustomer } from '@/lib/server/services/customers'
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

export const DELETE = route({
    role: 'admin',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => {
        await deleteCustomer(supabase, params.id)
        return noContent()
    }
})
