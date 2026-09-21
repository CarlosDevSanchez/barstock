import { created, route } from '@/lib/server/http'
import { createSale } from '@/lib/server/services/sales'
import { saleSchema } from '@/lib/validation/resources'

export const POST = route({
    role: 'cashier',
    body: saleSchema,
    handler: async ({ supabase, body }) => created(await createSale(supabase, body))
})
