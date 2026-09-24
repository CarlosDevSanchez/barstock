import { afterResponse } from '@/lib/server/after'
import { z } from 'zod'
import { badRequest } from '@/lib/server/errors'
import { created, route } from '@/lib/server/http'
import { createSale } from '@/lib/server/services/sales'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { saleSchema } from '@/lib/validation/resources'

const idempotencyKeySchema = z.uuid()

/** `null` when the header is absent (no idempotency protection); throws on a header present but malformed. */
function readIdempotencyKey(request: Request): string | null {
    const header = request.headers.get('Idempotency-Key')
    if (!header) return null
    const parsed = idempotencyKeySchema.safeParse(header)
    if (!parsed.success) throw badRequest('Idempotency-Key must be a UUID')
    return parsed.data
}

export const POST = route({
    role: 'cashier',
    body: saleSchema,
    handler: async ({ request, supabase, body }) => {
        const order = await createSale(supabase, body, readIdempotencyKey(request))
        afterResponse(() => {
            void dispatchOutbox()
        })
        return created(order)
    }
})
