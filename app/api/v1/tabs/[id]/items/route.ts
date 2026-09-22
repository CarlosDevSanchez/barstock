import { ok, route } from '@/lib/server/http'
import { addTabItems } from '@/lib/server/services/tabs'
import { idParamsSchema } from '@/lib/validation/common'
import { addTabItemsSchema } from '@/lib/validation/tabs'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: addTabItemsSchema,
    handler: async ({ supabase, params, body }) => ok(await addTabItems(supabase, params.id, body))
})
