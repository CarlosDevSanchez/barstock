import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { clientEnv } from '@/lib/env/client'

/** One place to change once `types/database.ts` exists: `SupabaseClient<Database>`. */
export type AppSupabaseClient = ReturnType<typeof createServerClient>

/**
 * Supabase client bound to the request's cookies: it carries the user's JWT, so RLS applies.
 * This is the ONLY client services should receive, apart from the admin client used to invite users.
 */
export async function createSupabaseServerClient(): Promise<AppSupabaseClient> {
    const cookieStore = await cookies()
    return createServerClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll: () => cookieStore.getAll(),
            setAll: cookiesToSet => {
                try {
                    for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
                } catch {
                    // Called from a Server Component, where cookies are read-only: proxy.ts refreshes the session.
                }
            }
        }
    })
}
