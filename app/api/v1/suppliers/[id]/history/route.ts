import { ok, route } from '@/lib/server/http'
import { supplierPurchaseHistory } from '@/lib/server/services/purchases'
import { idParamsSchema } from '@/lib/validation/common'
import { supplierHistoryQuerySchema } from '@/lib/validation/purchases'

export const GET = route({
    role: 'manager',
    params: idParamsSchema,
    query: supplierHistoryQuerySchema,
    handler: async ({ supabase, params, query }) => ok(await supplierPurchaseHistory(supabase, params.id, query))
})
