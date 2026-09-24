import { afterResponse } from '@/lib/server/after'
import { noContent, route } from '@/lib/server/http'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { voidPurchase } from '@/lib/server/services/purchases'
import { idParamsSchema } from '@/lib/validation/common'
import { purchaseVoidSchema } from '@/lib/validation/purchases'

export const DELETE = route({
    role: 'admin',
    params: idParamsSchema,
    body: purchaseVoidSchema,
    handler: async ({ supabase, params, body }) => {
        await voidPurchase(supabase, params.id, body)
        afterResponse(() => {
            void dispatchOutbox()
        })
        return noContent()
    }
})
