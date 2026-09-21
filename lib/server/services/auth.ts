import 'server-only'
import { serverEnv } from '@/lib/env/server'
import { forbidden, tooManyRequests, unauthorized, unprocessable } from '@/lib/server/errors'
import { loadSession, type SessionUser } from '@/lib/server/auth'
import type { AppSupabaseClient } from '@/lib/server/supabase'

/**
 * Password sign-in. The Auth server sets the session cookies through the request-bound client. The message for unknown
 * email and wrong password is the same, so the endpoint cannot be used to discover which emails exist.
 */
export async function signIn(supabase: AppSupabaseClient, email: string, password: string): Promise<SessionUser> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
        if (error.status === 429) throw tooManyRequests()
        throw unauthorized('Invalid email or password')
    }
    const session = await loadSession(supabase)
    if (!session) {
        // Valid credentials but no active profile (deactivated, or never assigned a role).
        await supabase.auth.signOut()
        throw forbidden('This account is disabled')
    }
    return session.user
}

export async function signOut(supabase: AppSupabaseClient): Promise<void> {
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
}
