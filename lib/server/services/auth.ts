import 'server-only'
import { serverEnv } from '@/lib/env/server'
import { setLocaleCookie } from '@/lib/i18n/cookie'
import { forbidden, tooManyRequests, unauthorized, unprocessable } from '@/lib/server/errors'
import { loadSession, type SessionUser } from '@/lib/server/auth'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin'
import type { Json } from '@/types/database'

type AuthEventAction = 'login' | 'logout' | 'invite' | 'password_reset'

/**
 * Records a session event through the append-only audit log (`docs/03-modulos/auditoria.md`). A failure here must
 * never break the auth flow it is attached to: it is logged server-side and swallowed.
 */
export async function logAuthEvent(
    supabase: AppSupabaseClient,
    action: AuthEventAction,
    metadata: Record<string, Json> = {}
): Promise<void> {
    const { error } = await supabase.rpc('log_auth_event', { p_action: action, p_metadata: metadata })
    if (error) console.error('[audit] failed to log auth event', action, error)
}

/** A wrong password or unknown email: no session exists yet, so the service_role client records it directly. */
async function logFailedLogin(email: string): Promise<void> {
    const admin = createSupabaseAdminClient()
    const { error } = await admin
        .from('audit_log')
        .insert({ actor_email: email, action: 'login_failed', entity: 'auth', source: 'api' })
    if (error) console.error('[audit] failed to log failed login', error)
}

/**
 * Password sign-in. The Auth server sets the session cookies through the request-bound client. The message for unknown
 * email and wrong password is the same, so the endpoint cannot be used to discover which emails exist.
 */
export async function signIn(supabase: AppSupabaseClient, email: string, password: string): Promise<SessionUser> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
        if (error.status === 429) throw tooManyRequests()
        await logFailedLogin(email)
        throw unauthorized('Invalid email or password')
    }
    const session = await loadSession(supabase)
    if (!session) {
        // Valid credentials but no active profile (deactivated, or never assigned a role).
        await supabase.auth.signOut()
        throw forbidden('This account is disabled')
    }
    await setLocaleCookie(session.user.locale)
    await logAuthEvent(supabase, 'login')
    return session.user
}

export async function signOut(supabase: AppSupabaseClient): Promise<void> {
    // Logged before signing out: the RPC needs the still-valid session to know who is logging out.
    await logAuthEvent(supabase, 'logout')
    await supabase.auth.signOut()
}

/** Always resolves: the caller answers 204 whether or not the email exists (no user enumeration). */
export async function requestPasswordReset(supabase: AppSupabaseClient, email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${serverEnv.APP_URL}/auth/confirm`
    })
    if (error) console.error('[auth] password reset request failed', error.status, error.code)
}

/** For a signed-in user (also the one that just accepted an invitation or a recovery link). */
export async function setPassword(supabase: AppSupabaseClient, password: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
        if (error.status === 429) throw tooManyRequests()
        throw unprocessable(error.message)
    }
    await logAuthEvent(supabase, 'password_reset')
}
