import 'server-only'
import { cookies } from 'next/headers'
import { LOCALE_COOKIE, type AppLocale } from './config'

/** Preference cookie (readable by the client). Not a session secret. */
export async function setLocaleCookie(locale: AppLocale): Promise<void> {
    const store = await cookies()
    store.set(LOCALE_COOKIE, locale, {
        path: '/',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365
    })
}
