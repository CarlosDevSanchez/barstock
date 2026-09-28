import { z } from 'zod'
import { badRequest } from '@/lib/server/errors'
import { ok, route } from '@/lib/server/http'
import { payReceivable } from '@/lib/server/services/receivables'
import { idParamsSchema } from '@/lib/validation/common'
import { payReceivableSchema } from '@/lib/validation/receivables'

const idempotencyKeySchema = z.uuid()

/** U3: mandatory here — a paid receivable can never safely be replayed without one. */
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
    body: payReceivableSchema,
    handler: async ({ request, supabase, params, body }) =>
        ok(await payReceivable(supabase, params.id, body, readIdempotencyKey(request)))
})
