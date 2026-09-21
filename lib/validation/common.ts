import { z } from 'zod'

/** '' and whitespace-only strings become null: optional/UNIQUE columns must never receive ''. */
export const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value)

/** Form inputs deliver strings: convert numeric ones, and treat '' as "not provided" (never as 0). */
const toNumber = (value: unknown) => {
    if (typeof value !== 'string') return value
    return value.trim() === '' ? undefined : Number(value)
}

const hasAtMostDecimals = (decimals: number) => (value: number) => {
    const scale = 10 ** decimals
    return Math.abs(value * scale - Math.round(value * scale)) < 1e-6
}

export const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max)
export const nullableText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional())
export const nullableUuid = z.preprocess(blankToNull, z.uuid().nullable().optional())
export const nullableEmail = z.preprocess(blankToNull, z.email().max(254).toLowerCase().nullable().optional())
export const nullableUrl = z.preprocess(blankToNull, z.url().max(2048).nullable().optional())

// NUMERIC(10,2). Float noise from client arithmetic (0.1 + 0.2) is tolerated and rounded to cents; real extra precision (1.005) is rejected.
export const money = z.preprocess(
    toNumber,
    z
        .number()
        .min(0)
        .max(99_999_999.99)
        .refine(hasAtMostDecimals(2), 'At most 2 decimals')
        .transform(value => Math.round(value * 100) / 100)
)
/** Tax rate as a fraction (0.10 = 10 %), NUMERIC(6,4). */
export const taxRate = z.preprocess(
    toNumber,
    z.number().min(0).max(1).refine(hasAtMostDecimals(4), 'At most 4 decimals')
)
export const positiveInt = (max: number) => z.preprocess(toNumber, z.number().int().min(1).max(max))

export const paginationSchema = z.object({
    page: positiveInt(100_000).default(1),
    pageSize: positiveInt(100).default(25),
    q: z.preprocess(value => blankToNull(value) ?? undefined, z.string().trim().max(100).optional())
})
export type Pagination = z.infer<typeof paginationSchema>

/** Zero-based inclusive range for Supabase `.range(from, to)`. */
export function pageRange({ page, pageSize }: Pick<Pagination, 'page' | 'pageSize'>) {
    return { from: (page - 1) * pageSize, to: page * pageSize - 1 }
}

/**
 * Strips the characters that carry meaning inside PostgREST `.or()` / `ilike` filter strings
 * (`, ( ) " \\ % * _`), so user input cannot inject extra filters or wildcards.
 */
export function sanitizeSearch(query: string): string {
    return query
        .replace(/[,()"'\\%*_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}
