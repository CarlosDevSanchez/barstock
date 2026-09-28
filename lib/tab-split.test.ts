import { describe, expect, test } from 'bun:test'
import { cashChange, cashDifference, paymentGap, splitEqual, splitRemainder, validateCustom } from './tab-split'

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

describe('cashDifference', () => {
    test('when received > due: change only, short is 0', () => {
        const result = cashDifference(50, 32.5, 2)
        expect(result.change).toBe(17.5)
        expect(result.short).toBe(0)
    })

    test('when received < due: short only, change is 0', () => {
        const result = cashDifference(10, 32.5, 2)
        expect(result.short).toBe(22.5)
        expect(result.change).toBe(0)
    })

    test('when received === due: both are 0', () => {
        const result = cashDifference(50, 50, 2)
        expect(result.change).toBe(0)
        expect(result.short).toBe(0)
    })

    test('COP (0 decimals): exact in minor units', () => {
        const result = cashDifference(50_000, 32_500, 0)
        expect(result.change).toBe(17_500)
        expect(result.short).toBe(0)
    })

    test('COP (0 decimals): short when received < due', () => {
        const result = cashDifference(32_000, 50_000, 0)
        expect(result.change).toBe(0)
        expect(result.short).toBe(18_000)
    })
})

describe('split payment amounts', () => {
    test('remainder, gap and change stay exact in minor units', () => {
        expect(splitRemainder(10, 3, 0)).toBe(7)
        expect(splitRemainder(10, 3.33, 2)).toBe(6.67)
        expect(splitRemainder(10, 12, 0)).toBe(0)
        expect(paymentGap(10, [3, 6], 0)).toBe(1)
        expect(paymentGap(10, [6, 6], 0)).toBe(-2)
        expect(paymentGap(10, [3.33, 6.67], 2)).toBe(0)
        expect(cashChange(50, 32.5, 2)).toBe(17.5)
        expect(cashChange(10, 32.5, 2)).toBe(0)
    })
})
