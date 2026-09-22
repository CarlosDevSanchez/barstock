import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { money, nullableEmail, nullableText, pageRange, paginationSchema, sanitizeSearch, taxRate } from './common'

describe('money', () => {
    test('accepts numbers and numeric strings', () => {
        expect(money.parse(10.5)).toBe(10.5)
        expect(money.parse('10.50')).toBe(10.5)
        expect(money.parse(0)).toBe(0)
    })
    test('rejects blank, negative, non-numeric, too precise and out-of-range values', () => {
        expect(money.safeParse('').success).toBe(false) // never coerced to 0
        expect(money.safeParse('  ').success).toBe(false)
        expect(money.safeParse(-1).success).toBe(false)
        expect(money.safeParse('abc').success).toBe(false)
        expect(money.safeParse(NaN).success).toBe(false)
        expect(money.safeParse(1.005).success).toBe(false)
        expect(money.safeParse(100_000_000).success).toBe(false)
    })
    test('float noise is rounded to cents instead of rejected', () => {
        expect(money.parse(0.1 + 0.2)).toBe(0.3)
        expect(money.parse(19.99)).toBe(19.99)
        expect(money.parse('1.10')).toBe(1.1)
    })
})

describe('taxRate', () => {
    test('is a fraction between 0 and 1 with at most 4 decimals', () => {
        expect(taxRate.parse('0.10')).toBe(0.1)
        expect(taxRate.parse(0.0725)).toBe(0.0725)
        expect(taxRate.safeParse(10).success).toBe(false) // 10 % typed as 10
        expect(taxRate.safeParse(0.07255).success).toBe(false)
    })
})

describe('blank normalization', () => {
    test("turns '' into null for optional text and email", () => {
        expect(nullableText(10).parse('')).toBeNull()
        expect(nullableText(10).parse('   ')).toBeNull()
        expect(nullableEmail.parse('')).toBeNull()
    })
    test('keeps undefined as undefined (field not sent)', () => {
        expect(z.object({ a: nullableText(10) }).parse({})).toEqual({})
    })
    test('trims and lowercases', () => {
        expect(nullableText(10).parse('  hi ')).toBe('hi')
        expect(nullableEmail.parse('A@B.com')).toBe('a@b.com')
    })
    test('enforces the max length', () => {
        expect(nullableText(3).safeParse('abcd').success).toBe(false)
    })
})

describe('pagination', () => {
    test('applies defaults', () => {
        expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 25 })
    })
    test('coerces query-string values and drops blank q', () => {
        expect(paginationSchema.parse({ page: '2', pageSize: '50', q: ' beer ' })).toEqual({
            page: 2,
            pageSize: 50,
            q: 'beer'
        })
        expect(paginationSchema.parse({ q: '' }).q).toBeUndefined()
    })
    test('rejects out-of-range values', () => {
        expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false)
        expect(paginationSchema.safeParse({ pageSize: '101' }).success).toBe(false)
        expect(paginationSchema.safeParse({ page: '1.5' }).success).toBe(false)
    })
    test('pageRange is zero-based and inclusive', () => {
        expect(pageRange({ page: 1, pageSize: 25 })).toEqual({ from: 0, to: 24 })
        expect(pageRange({ page: 3, pageSize: 10 })).toEqual({ from: 20, to: 29 })
    })
})

describe('sanitizeSearch', () => {
    test('removes PostgREST filter syntax and LIKE wildcards', () => {
        expect(sanitizeSearch('a,b')).toBe('a b')
        expect(sanitizeSearch('x),sku.eq.1,(y')).toBe('x sku.eq.1 y')
        expect(sanitizeSearch('100%_off*')).toBe('100 off')
        expect(sanitizeSearch('  plain  text ')).toBe('plain text')
    })
})
