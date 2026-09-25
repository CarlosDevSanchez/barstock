import { z } from 'zod'
import { afterResponse } from '@/lib/server/after'
import { badRequest } from '@/lib/server/errors'
import { ok, route } from '@/lib/server/http'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { deferTab } from '@/lib/server/services/receivables'
import { idParamsSchema } from '@/lib/validation/common'
import { deferTabSchema } from '@/lib/validation/receivables'

const idempotencyKeySchema = z.uuid()

/** Mandatory — same as receivables payments. A defer must not be replayable without a key. */
function readIdempotencyKey(request: Request): string {
    const header = request.headers.get('Idempotency-Key')
    if (!header) throw badRequest('Idempotency-Key is required')
    const parsed = idempotencyKeySchema.safeParse(header)
    if (!parsed.success) throw badRequest('Idempotency-Key must be a UUID')
    return parsed.data
}

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: deferTabSchema,
    handler: async ({ request, supabase, params, body }) => {
        const order = await deferTab(supabase, params.id, body, readIdempotencyKey(request))
        afterResponse(() => dispatchOutbox())
        return ok(order)
    }
})
