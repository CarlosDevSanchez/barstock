import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env/server'

/**
 * service_role client: BYPASSES RLS. Used for `auth.admin` calls (inviting users) in lib/server/services/users.ts.
 * Outbox dispatch (`lib/server/services/notifications.ts`) is the second allowed caller.
 * Never pass it to other services, never expose it to the browser.
 */
export function createSupabaseAdminClient() {
    return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    })
}
