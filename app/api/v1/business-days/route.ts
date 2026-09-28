import { created, ok, route } from '@/lib/server/http'
import { listBusinessDays, openBusinessDay } from '@/lib/server/services/business-days'
import { businessDaysQuerySchema, openBusinessDaySchema } from '@/lib/validation/cash'

export const GET = route({
    role: 'manager',
    query: businessDaysQuerySchema,
    handler: async ({ supabase, query }) => ok(await listBusinessDays(supabase, query.needs_review))
})

export const POST = route({
    role: 'cashier',
    body: openBusinessDaySchema,
    handler: async ({ supabase, body }) => created(await openBusinessDay(supabase, body.notes ?? null))
})
