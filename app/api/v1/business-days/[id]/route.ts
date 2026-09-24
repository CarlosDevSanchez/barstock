import { ok, route } from '@/lib/server/http'
import { adjustBusinessDay } from '@/lib/server/services/business-days'
import { getBusinessDayReport } from '@/lib/server/services/reports'
import { idParamsSchema } from '@/lib/validation/common'
import { adjustBusinessDaySchema } from '@/lib/validation/cash'

export const GET = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ supabase, params }) => ok(await getBusinessDayReport(supabase, params.id))
})

export const PATCH = route({
    role: 'admin',
    params: idParamsSchema,
    body: adjustBusinessDaySchema,
    handler: async ({ supabase, params, body }) => ok(await adjustBusinessDay(supabase, params.id, body))
})
