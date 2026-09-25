import { afterResponse } from '@/lib/server/after'
import { ok, route } from '@/lib/server/http'
import { addTabItems } from '@/lib/server/services/tabs'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { idParamsSchema } from '@/lib/validation/common'
import { addTabItemsSchema } from '@/lib/validation/tabs'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: addTabItemsSchema,
    handler: async ({ supabase, params, body }) => {
        const result = await addTabItems(supabase, params.id, body)
        afterResponse(() => {
            void dispatchOutbox()
        })
        return ok(result)
    }
})
