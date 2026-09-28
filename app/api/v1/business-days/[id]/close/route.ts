import { ok, route } from '@/lib/server/http'
import { closeBusinessDay } from '@/lib/server/services/business-days'
import { idParamsSchema } from '@/lib/validation/common'
import { closeBusinessDaySchema } from '@/lib/validation/cash'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: closeBusinessDaySchema,
    handler: async ({ supabase, params, body }) => ok(await closeBusinessDay(supabase, params.id, body.notes ?? null))
})
