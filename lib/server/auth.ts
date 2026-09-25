import 'server-only'
import { cache } from 'react'
import { z } from 'zod'
import { roleAtLeast, USER_ROLES, type UserRole } from '@/lib/auth/roles'
import { APP_LOCALES, type AppLocale } from '@/lib/i18n/config'
import { forbidden, unauthorized } from './errors'
import { createSupabaseServerClient, type AppSupabaseClient } from './supabase'

export interface SessionUser {
    id: string
    email: string
    fullName: string | null
    role: UserRole
    locale: AppLocale
    notifyEmail: boolean
    notifyPush: boolean
}

export interface Session {
    user: SessionUser
    supabase: AppSupabaseClient
}

const profileSchema = z.object({
    role: z.enum(USER_ROLES),
    full_name: z.string().nullable(),
    is_active: z.boolean(),
    locale: z.enum(APP_LOCALES),
    notify_email: z.boolean().optional(),
    notify_push: z.boolean().optional()
})

type LooseProfileClient = {
    from: (table: 'profiles') => {
        select: (columns: string) => {
            eq: (
                column: string,
                value: string
            ) => {
                maybeSingle: () => PromiseLike<{
                    data: Record<string, unknown> | null
                    error: { message: string; code?: string } | null
                }>
            }
        }
    }
}

// notify_* columns arrive with migration 20261005000004; select via loose client until db:types regenerates.
function selectProfile(supabase: AppSupabaseClient, userId: string, withNotifyColumns: boolean) {
    const columns = withNotifyColumns
        ? 'role, full_name, is_active, locale, notify_email, notify_push'
        : 'role, full_name, is_active, locale'
    return (supabase as unknown as LooseProfileClient).from('profiles').select(columns).eq('id', userId).maybeSingle()
}

/**
 * Resolves the caller from the session held by `supabase`. `auth.getUser()` validates the JWT against Supabase Auth
 * (unlike `getSession()`, which trusts the cookie). The role is read from `profiles` on every request, so a role change
 * or deactivation takes effect immediately. Returns null when there is no valid, active user.
 */
export async function loadSession(supabase: AppSupabaseClient): Promise<Session | null> {
    const {
        data: { user },
        error
    } = await supabase.auth.getUser()
    if (error || !user) return null

    let { data, error: profileError } = await selectProfile(supabase, user.id, true)
    // Tolerates code deployed ahead of migration 20261005000004: a missing-column error (42703) falls back to a
    // select without notify_* and defaults both to true, instead of failing every session in the fleet.
    if (profileError?.code === '42703') {
        ;({ data, error: profileError } = await selectProfile(supabase, user.id, false))
    }
    if (profileError || !data) return null

    const profile = profileSchema.safeParse(data)
    if (!profile.success || !profile.data.is_active) return null

    return {
        user: {
            id: user.id,
            email: user.email ?? '',
            fullName: profile.data.full_name,
            role: profile.data.role,
            locale: profile.data.locale,
            notifyEmail: profile.data.notify_email ?? true,
            notifyPush: profile.data.notify_push ?? true
        },
        supabase
    }
}

/** Shared across the root layout and `i18n/request.ts` in the same request. */
export const getSession = cache(async (): Promise<Session | null> => {
    return loadSession(await createSupabaseServerClient())
})

export async function requireUser(): Promise<Session> {
    const session = await getSession()
    if (!session) throw unauthorized()
    return session
}

/** Requires at least `minimum` (roles are hierarchical: admin ≥ manager ≥ cashier). */
export async function requireRole(minimum: UserRole): Promise<Session> {
    const session = await requireUser()
    if (!roleAtLeast(session.user.role, minimum)) throw forbidden()
    return session
}
