import 'server-only'
import { AppError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { currencyDecimals, hasValidMoneyScale } from '@/lib/money'
import { sanitizeSearch } from '@/lib/validation/common'
import { getSettings } from './settings'

export interface Page<T> {
    rows: T[]
    total: number
}

/**
 * Builds the value for PostgREST `.or()` (`col.ilike.%term%,…`) from user input. Returns null when there is nothing to
 * search. The term is sanitized: characters that carry meaning in filter syntax would otherwise inject extra filters.
 */
export function searchFilter(query: string | undefined, columns: readonly string[]): string | null {
    const term = query ? sanitizeSearch(query) : ''
    return term ? columns.map(column => `${column}.ilike.%${term}%`).join(',') : null
}

/**
 * Prices and discounts are validated with 2 decimals at most (NUMERIC(14,2)), but the store currency may allow fewer:
 * COP is charged in whole pesos, so 35 000.50 must never reach the database (the till preview and `create_sale` would
 * disagree). Reads the currency from `settings` and throws a validation error naming the offending fields.
 */
export async function assertMoneyScale(
    supabase: AppSupabaseClient,
    fields: Record<string, number | null | undefined>
): Promise<void> {
    const entries = Object.entries(fields).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    if (entries.length === 0) return
    const { currency } = await getSettings(supabase)
    const invalid = entries.filter(([, value]) => !hasValidMoneyScale(value, currency))
    if (invalid.length === 0) return
    const message = currencyDecimals(currency) === 0 ? 'validation.noDecimals' : 'validation.atMostTwoDecimals'
    throw new AppError(
        'validation_failed',
        'The request is not valid',
        invalid.map(([path]) => ({ path, message }))
    )
}
