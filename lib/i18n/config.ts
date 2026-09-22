export const APP_LOCALES = ['es', 'en'] as const
export type AppLocale = (typeof APP_LOCALES)[number]

export const DEFAULT_APP_LOCALE: AppLocale = 'es'
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isAppLocale(value: unknown): value is AppLocale {
    return value === 'es' || value === 'en'
}

/** BCP-47 tag used by `Intl` / `formatMoney` for the UI language. */
export function moneyLocale(locale: AppLocale): string {
    return locale === 'es' ? 'es-CO' : 'en-US'
}
