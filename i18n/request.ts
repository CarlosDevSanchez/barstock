import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { DEFAULT_APP_LOCALE, isAppLocale, LOCALE_COOKIE, type AppLocale } from '@/lib/i18n/config'
import { getSession } from '@/lib/server/auth'

export default getRequestConfig(async () => {
    const session = await getSession()
    const cookie = (await cookies()).get(LOCALE_COOKIE)?.value
    const locale: AppLocale = isAppLocale(session?.user.locale)
        ? session.user.locale
        : isAppLocale(cookie)
          ? cookie
          : DEFAULT_APP_LOCALE

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default
    }
})
