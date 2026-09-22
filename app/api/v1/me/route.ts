import { ok, route } from '@/lib/server/http'

export const GET = route({ role: 'cashier', handler: async ({ user }) => ok(user) })
