import { after } from 'next/server'
import { z } from 'zod'
import { ok, route } from '@/lib/server/http'
import { removeTabItem } from '@/lib/server/services/tabs'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { removeTabItemSchema } from '@/lib/validation/tabs'

const paramsSchema = z.object({ id: z.guid(), itemId: z.guid() })

/** Removing (or reducing) a line needs a manager+ and a reason, same as a refund. */
export const DELETE = route({
    role: 'manager',
    params: paramsSchema,
    body: removeTabItemSchema,
    handler: async ({ supabase, params, body }) => {
        const result = await removeTabItem(supabase, params.id, params.itemId, body)
        after(() => {
            void dispatchOutbox()
        })
        return ok(result)
    }
})
