import { describe, expect, test } from 'bun:test'
import { formatMoneyInput, parseMoneyInput } from './money-input'

describe('parseMoneyInput', () => {
    describe('COP (decimals = 0)', () => {
        test('parses thousands separator as dot', () => {
            expect(parseMoneyInput('50.000', 0)).toBe(50000)
        })

        test('parses thousands separator as comma', () => {
            expect(parseMoneyInput('50,000', 0)).toBe(50000)
        })

        test('parses a small number without separator', () => {
            expect(parseMoneyInput('5', 0)).toBe(5)
        })

        test('parses multiple separators correctly', () => {
            expect(parseMoneyInput('1.234.567', 0)).toBe(1234567)
            expect(parseMoneyInput('1,234,567', 0)).toBe(1234567)
        })

        test('returns null for empty string', () => {
            expect(parseMoneyInput('', 0)).toBeNull()
        })

        test('returns null for whitespace only', () => {
            expect(parseMoneyInput('   ', 0)).toBeNull()
        })

        test('returns null for non-numeric input', () => {
            expect(parseMoneyInput('abc', 0)).toBeNull()
            expect(parseMoneyInput('50x', 0)).toBeNull()
        })

        test('treats dot and comma as thousands separators, not decimal points', () => {
            // "50.5" should be parsed as 505 (the . is a thousands sep), not 50.5
            expect(parseMoneyInput('50.5', 0)).toBe(505)
            expect(parseMoneyInput('50,5', 0)).toBe(505)
        })
    })

    describe('USD (decimals = 2)', () => {
        test('parses comma as decimal separator with es-CO style', () => {
            expect(parseMoneyInput('12,50', 2)).toBe(12.5)
        })

        test('parses dot as decimal separator with en-US style', () => {
            expect(parseMoneyInput('12.50', 2)).toBe(12.5)
        })

        test('parses incomplete decimal', () => {
            expect(parseMoneyInput('12,5', 2)).toBe(12.5)
        })

        test('parses integer without decimal separator', () => {
            expect(parseMoneyInput('100', 2)).toBe(100)
        })

        test('parses with thousands separator and decimal', () => {
            expect(parseMoneyInput('1,234.56', 2)).toBe(1234.56)
            expect(parseMoneyInput('1.234,56', 2)).toBe(1234.56)
        })

        test('returns null for empty string', () => {
            expect(parseMoneyInput('', 2)).toBeNull()
        })

        test('returns null for non-numeric input', () => {
            expect(parseMoneyInput('abc', 2)).toBeNull()
            expect(parseMoneyInput('12.34.56', 2)).toBeNull()
        })

        test('returns null for just a separator', () => {
            expect(parseMoneyInput('.', 2)).toBeNull()
            expect(parseMoneyInput(',', 2)).toBeNull()
        })

        test('parses leading decimal as 0.x', () => {
            expect(parseMoneyInput('.5', 2)).toBe(0.5)
            expect(parseMoneyInput(',5', 2)).toBe(0.5)
        })
    })
})

describe('formatMoneyInput', () => {
    describe('COP (decimals = 0)', () => {
        test('formats with es-CO thousands separator (dot)', () => {
            expect(formatMoneyInput(50000, 0, 'es-CO')).toBe('50.000')
        })

        test('formats with en-US thousands separator (comma)', () => {
            expect(formatMoneyInput(50000, 0, 'en-US')).toBe('50,000')
        })

        test('formats zero', () => {
            expect(formatMoneyInput(0, 0, 'es-CO')).toBe('0')
        })

        test('returns empty string for null', () => {
            expect(formatMoneyInput(null, 0, 'es-CO')).toBe('')
        })
    })

    describe('USD (decimals = 2)', () => {
        test('formats with es-CO style (dot thousands, comma decimal)', () => {
            expect(formatMoneyInput(12.5, 2, 'es-CO')).toBe('12,50')
        })

        test('formats with en-US style (comma thousands, dot decimal)', () => {
            expect(formatMoneyInput(12.5, 2, 'en-US')).toBe('12.50')
        })

        test('formats large amounts with thousands separators', () => {
            expect(formatMoneyInput(1234.56, 2, 'es-CO')).toBe('1.234,56')
            expect(formatMoneyInput(1234.56, 2, 'en-US')).toBe('1,234.56')
        })

        test('formats zero', () => {
            expect(formatMoneyInput(0, 2, 'es-CO')).toBe('0,00')
        })

        test('returns empty string for null', () => {
            expect(formatMoneyInput(null, 2, 'es-CO')).toBe('')
        })
    })

    describe('round-trip: parse then format', () => {
        test('COP: "50.000" → 50000 → "50.000"', () => {
            const parsed = parseMoneyInput('50.000', 0)
            const formatted = formatMoneyInput(parsed, 0, 'es-CO')
            expect(formatted).toBe('50.000')
        })

        test('USD: "12,50" → 12.5 → "12,50"', () => {
            const parsed = parseMoneyInput('12,50', 2)
            const formatted = formatMoneyInput(parsed, 2, 'es-CO')
            expect(formatted).toBe('12,50')
        })

        test('USD: "1.234,56" → 1234.56 → "1.234,56"', () => {
            const parsed = parseMoneyInput('1.234,56', 2)
            const formatted = formatMoneyInput(parsed, 2, 'es-CO')
            expect(formatted).toBe('1.234,56')
        })
    })
})
