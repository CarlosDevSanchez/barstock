/**
 * Session cookie hardening. `@supabase/ssr` creates its cookies with `httpOnly: false` because its browser client needs to read
 * them. Here the browser never talks to Supabase, so scripts must not be able to read the session at all: an XSS could otherwise
 * steal the refresh token. `Secure` is added in production (browsers refuse it over plain http, e.g. Safari on localhost).
 */
export function sessionCookieOptions<T extends object>(options?: T): T & { httpOnly: true; secure: boolean } {
    return { ...(options as T), httpOnly: true, secure: process.env.NODE_ENV === 'production' }
}
