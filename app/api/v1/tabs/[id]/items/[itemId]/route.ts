import { z } from 'zod'
import { ok, route } from '@/lib/server/http'
import { removeTabItem } from '@/lib/server/services/tabs'
import { removeTabItemSchema } from '@/lib/validation/tabs'

const paramsSchema = z.object({ id: z.guid(), itemId: z.guid() })

/** Removing (or reducing) a line needs a manager+ and a reason, same as a refund. */
export const DELETE = route({
    role: 'manager',
    params: paramsSchema,
    body: removeTabItemSchema,
    handler: async ({ supabase, params, body }) => ok(await removeTabItem(supabase, params.id, params.itemId, body))
})
