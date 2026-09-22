import { ok, route } from '@/lib/server/http'
import { adjustInventory } from '@/lib/server/services/inventory'
import { idParamsSchema } from '@/lib/validation/common'
import { inventoryAdjustSchema } from '@/lib/validation/resources'

export const POST = route({
    role: 'manager',
    params: idParamsSchema,
    body: inventoryAdjustSchema,
    handler: async ({ supabase, params, body }) =>
        ok(await adjustInventory(supabase, params.id, body.delta, body.reason))
})
