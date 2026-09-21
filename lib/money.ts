const formatters = new Map<string, Intl.NumberFormat>()

/** Formats an amount with the currency from `settings` (D4: one currency per installation). Never accumulate floats to write. */
export function formatMoney(amount: number, currency = 'USD', locale = 'en-US'): string {
    const key = `${locale}|${currency}`
    let formatter = formatters.get(key)
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
        formatters.set(key, formatter)
    }
    return formatter.format(amount)
}
