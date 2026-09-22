/**
 * Currencies whose minor unit is not used in practice (whole units only). `Intl` reports 2 decimals for COP, so it cannot
 * be the source of truth. MUST match `public.currency_decimals()` in the database (a test compares both).
 */
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = [
    'BIF',
    'CLP',
    'COP',
    'DJF',
    'GNF',
    'ISK',
    'JPY',
    'KMF',
    'KRW',
    'PYG',
    'RWF',
    'UGX',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF'
]

export const DEFAULT_CURRENCY = 'COP'
export const DEFAULT_LOCALE = 'es-CO'

/** Decimal places prices and totals are stored and charged with: 0 for COP, 2 for USD/EUR… */
export function currencyDecimals(currency: string): 0 | 2 {
    return ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase()) ? 0 : 2
}

/** `step` attribute for a price input in the given currency. */
export const moneyStep = (currency: string): 1 | 0.01 => (currencyDecimals(currency) === 0 ? 1 : 0.01)

/** Rounds (half away from zero) to the currency's decimals, correcting float noise such as 1.005. */
export function roundMoney(amount: number, currency: string): number {
    const scale = 10 ** currencyDecimals(currency)
    return Math.round(Number((amount * scale).toPrecision(15))) / scale
}

/** True when `amount` needs no more decimals than the currency allows (tolerates float noise). */
export function hasValidMoneyScale(amount: number, currency: string): boolean {
    const scale = 10 ** currencyDecimals(currency)
    return Math.abs(amount * scale - Math.round(amount * scale)) < 1e-6
}

const formatters = new Map<string, Intl.NumberFormat>()

/**
 * Formats an amount with the currency from `settings` (D4: one currency per installation). `locale` only decides the
 * separators ("$ 35.000" in es-CO, "$35,000" in en-US); the number of decimals comes from the currency.
 * Never accumulate floats to write.
 */
export function formatMoney(amount: number, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE): string {
    const key = `${locale}|${currency}`
    let formatter = formatters.get(key)
    if (!formatter) {
        const decimals = currencyDecimals(currency)
        formatter = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        })
        formatters.set(key, formatter)
    }
    return formatter.format(amount)
}
