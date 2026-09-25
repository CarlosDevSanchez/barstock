import { afterResponse } from '@/lib/server/after'
import { created, route } from '@/lib/server/http'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { receivePurchase } from '@/lib/server/services/purchases'
import { purchaseReceiveSchema } from '@/lib/validation/purchases'

export const POST = route({
    role: 'manager',
    body: purchaseReceiveSchema,
    handler: async ({ supabase, body }) => {
        const result = await receivePurchase(supabase, body)
        afterResponse(() => {
            void dispatchOutbox()
        })
        return created(result)
    }
})
