import { afterResponse } from '@/lib/server/after'
import { ok, route } from '@/lib/server/http'
import { adjustInventory } from '@/lib/server/services/inventory'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { idParamsSchema } from '@/lib/validation/common'
import { inventoryAdjustSchema } from '@/lib/validation/resources'

export const POST = route({
    role: 'manager',
    params: idParamsSchema,
    body: inventoryAdjustSchema,
    handler: async ({ supabase, params, body }) => {
        const result = await adjustInventory(supabase, params.id, body.delta, body.reason)
        afterResponse(() => dispatchOutbox())
        return ok(result)
    }
})
