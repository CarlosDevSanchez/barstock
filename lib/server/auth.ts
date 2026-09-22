import 'server-only'
import { z } from 'zod'
import { roleAtLeast, USER_ROLES, type UserRole } from '@/lib/auth/roles'
import { forbidden, unauthorized } from './errors'
import { createSupabaseServerClient, type AppSupabaseClient } from './supabase'

export interface SessionUser {
    id: string
    email: string
    fullName: string | null
    role: UserRole
}

export interface Session {
    user: SessionUser
    supabase: AppSupabaseClient
}

const profileSchema = z.object({
    role: z.enum(USER_ROLES),
    full_name: z.string().nullable(),
    is_active: z.boolean()
})

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

    const { data, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name, is_active')
        .eq('id', user.id)
        .maybeSingle()
    if (profileError || !data) return null

    const profile = profileSchema.safeParse(data)
    if (!profile.success || !profile.data.is_active) return null

    return {
        user: {
            id: user.id,
            email: user.email ?? '',
            fullName: profile.data.full_name,
            role: profile.data.role
        },
        supabase
    }
}

export async function getSession(): Promise<Session | null> {
    return loadSession(await createSupabaseServerClient())
}

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
