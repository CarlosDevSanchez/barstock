/**
 * Session cookie hardening. `@supabase/ssr` creates its cookies with `httpOnly: false` because its browser client needs to read
 * them. Here the browser never talks to Supabase, so scripts must not be able to read the session at all: an XSS could otherwise
 * steal the refresh token.
 *
 * `Secure` follows how the app is actually served (`APP_URL` starts with https://), not NODE_ENV: a production build that runs on
 * http://localhost (the Docker setup) must still set cookies, and Safari refuses `Secure` cookies over plain http.
 */
export function sessionCookieOptions<T extends object>(options?: T): T & { httpOnly: true; secure: boolean } {
    const servedOverHttps = (process.env.APP_URL ?? '').startsWith('https://')
    return { ...(options as T), httpOnly: true, secure: servedOverHttps }
}
