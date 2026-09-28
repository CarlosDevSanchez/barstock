import { z } from 'zod'
import { afterResponse } from '@/lib/server/after'
import { badRequest } from '@/lib/server/errors'
import { created, route } from '@/lib/server/http'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { receivePurchase } from '@/lib/server/services/purchases'
import { purchaseReceiveSchema } from '@/lib/validation/purchases'

const idempotencyKeySchema = z.uuid()

/** U3: mandatory — a retried receive can never safely double the stock it adds. */
function readIdempotencyKey(request: Request): string {
    const header = request.headers.get('Idempotency-Key')
    if (!header) throw badRequest('Idempotency-Key is required')
    const parsed = idempotencyKeySchema.safeParse(header)
    if (!parsed.success) throw badRequest('Idempotency-Key must be a UUID')
    return parsed.data
}

export const POST = route({
    role: 'manager',
    body: purchaseReceiveSchema,
    handler: async ({ request, supabase, body }) => {
        const result = await receivePurchase(supabase, body, readIdempotencyKey(request))
        afterResponse(() => dispatchOutbox())
        return created(result)
    }
})
