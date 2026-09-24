import { ok, route } from '@/lib/server/http'
import { getPosSnapshot } from '@/lib/server/services/pos'

export const GET = route({
    role: 'cashier',
    handler: async ({ supabase }) => ok(await getPosSnapshot(supabase))
})
