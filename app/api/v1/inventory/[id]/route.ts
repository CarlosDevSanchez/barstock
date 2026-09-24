import { ok, route } from '@/lib/server/http'
import { setThreshold } from '@/lib/server/services/inventory'
import { idParamsSchema } from '@/lib/validation/common'
import { inventoryThresholdSchema } from '@/lib/validation/resources'

export const PATCH = route({
    role: 'manager',
    params: idParamsSchema,
    body: inventoryThresholdSchema,
    handler: async ({ supabase, params, body }) => ok(await setThreshold(supabase, params.id, body.low_stock_threshold))
})
