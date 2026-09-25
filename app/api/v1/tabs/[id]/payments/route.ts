import { z } from 'zod'
import { badRequest } from '@/lib/server/errors'
import { afterResponse } from '@/lib/server/after'
import { ok, route } from '@/lib/server/http'
import { payTab, payTabSplit } from '@/lib/server/services/tabs'
import { dispatchOutbox } from '@/lib/server/services/notifications'
import { idParamsSchema } from '@/lib/validation/common'
import { payTabBodySchema } from '@/lib/validation/tabs'

const idempotencyKeySchema = z.uuid()

/** Unlike receivables' `Idempotency-Key` (mandatory), this one is optional so far, to not break existing/older
 * clients that don't send it yet (see supabase/migrations/20261007000001_tab_payments_hardening.sql). */
function readIdempotencyKey(request: Request): string | undefined {
    const header = request.headers.get('Idempotency-Key')
    if (!header) return undefined
    const parsed = idempotencyKeySchema.safeParse(header)
    if (!parsed.success) throw badRequest('Idempotency-Key must be a UUID')
    return parsed.data
}

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: payTabBodySchema,
    handler: async ({ request, supabase, params, body }) => {
        const idempotencyKey = readIdempotencyKey(request)
        const result =
            'payments' in body
                ? await payTabSplit(supabase, params.id, body, idempotencyKey)
                : await payTab(supabase, params.id, body, idempotencyKey)
        afterResponse(() => dispatchOutbox())
        return ok(result)
    }
})
