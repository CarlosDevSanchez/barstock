import { ok, route } from '@/lib/server/http'
import { getDashboardSummary } from '@/lib/server/services/reports'

export const GET = route({ role: 'cashier', handler: async ({ supabase }) => ok(await getDashboardSummary(supabase)) })
