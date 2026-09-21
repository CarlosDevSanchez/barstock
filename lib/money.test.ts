import { describe, expect, test } from 'bun:test'
import { formatMoney } from './money'

describe('formatMoney', () => {
    test('uses the given currency and locale', () => {
        expect(formatMoney(1234.5)).toBe('$1,234.50')
        expect(formatMoney(1234.5, 'EUR', 'de-DE').replace(/\s/g, ' ')).toBe('1.234,50 €')
        expect(formatMoney(0, 'GBP', 'en-GB')).toBe('£0.00')
    })
    test('rounds to the currency minor unit', () => {
        expect(formatMoney(2.005)).toBe('$2.01')
    })
})
