import { describe, expect, test } from 'bun:test'
import { splitEqual, validateCustom } from './tab-split'

describe('splitEqual', () => {
    test('divides evenly when it divides evenly', () => {
        expect(splitEqual(90, 3, 2)).toEqual([30, 30, 30])
        expect(splitEqual(90_000, 3, 0)).toEqual([30_000, 30_000, 30_000])
    })

    test('COP (0 decimals): the remainder goes to the first shares, one unit at a time, and the sum is exact', () => {
        const shares = splitEqual(100_000, 3, 0)
        expect(shares).toEqual([33_334, 33_333, 33_333])
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100_000)
    })

    test('USD (2 decimals): the sum is exact in cents, never drifted by float division', () => {
        const shares = splitEqual(10, 3, 2)
        expect(shares).toEqual([3.34, 3.33, 3.33])
        expect(Math.round(shares.reduce((sum, share) => sum + share, 0) * 100)).toBe(1000)
    })

    test('a single person gets the whole balance', () => {
        expect(splitEqual(42.5, 1, 2)).toEqual([42.5])
    })

    test('rejects a non-positive or non-integer count', () => {
        expect(() => splitEqual(10, 0, 2)).toThrow()
        expect(() => splitEqual(10, -1, 2)).toThrow()
        expect(() => splitEqual(10, 1.5, 2)).toThrow()
    })
})

describe('validateCustom', () => {
    test('valid when the shares add up to exactly the balance', () => {
        expect(validateCustom([5, 5], 10, 2)).toEqual({ sum: 10, remaining: 0, valid: true })
    })

    test('valid but incomplete when the shares add up to less (paid later)', () => {
        expect(validateCustom([4], 10, 2)).toEqual({ sum: 4, remaining: 6, valid: true })
    })

    test('invalid when the shares add up to more than the balance', () => {
        const result = validateCustom([7, 7], 10, 2)
        expect(result.valid).toBe(false)
        expect(result.sum).toBe(14)
        expect(result.remaining).toBe(-4)
    })

    test('COP (0 decimals): whole-peso amounts only, no float noise', () => {
        expect(validateCustom([33_334, 33_333, 33_333], 100_000, 0)).toEqual({
            sum: 100_000,
            remaining: 0,
            valid: true
        })
    })
})
