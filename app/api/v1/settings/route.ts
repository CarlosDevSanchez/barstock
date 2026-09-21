import { ok, route } from '@/lib/server/http'
import { getSettings, updateSettings } from '@/lib/server/services/settings'
import { settingsUpdateSchema } from '@/lib/validation/resources'

export const GET = route({ role: 'cashier', handler: async ({ supabase }) => ok(await getSettings(supabase)) })

export const PATCH = route({
    role: 'admin',
    body: settingsUpdateSchema,
    handler: async ({ supabase, body }) => ok(await updateSettings(supabase, body))
})
