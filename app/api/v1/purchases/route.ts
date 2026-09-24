import { created, route } from '@/lib/server/http'
import { receivePurchase } from '@/lib/server/services/purchases'
import { purchaseReceiveSchema } from '@/lib/validation/purchases'

export const POST = route({
    role: 'manager',
    body: purchaseReceiveSchema,
    handler: async ({ supabase, body }) => created(await receivePurchase(supabase, body))
})
