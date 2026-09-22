import 'server-only'
import { sanitizeSearch } from '@/lib/validation/common'

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
