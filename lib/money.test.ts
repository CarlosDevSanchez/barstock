import { describe, expect, test } from 'bun:test'
import {
    currencyDecimals,
    formatMoney,
    hasValidMoneyScale,
    moneyStep,
    roundMoney,
    ZERO_DECIMAL_CURRENCIES
} from './money'

const plain = (text: string) => text.replace(/\s/g, ' ')

describe('currencyDecimals', () => {
    test('COP and the other whole-unit currencies have no decimals; the rest have 2', () => {
        for (const currency of ['COP', 'CLP', 'JPY', 'KRW', 'PYG', 'ISK', 'VND'])
            expect(currencyDecimals(currency)).toBe(0)
        for (const currency of ['USD', 'EUR', 'GBP', 'MXN', 'BRL']) expect(currencyDecimals(currency)).toBe(2)
    })
    test('is case-insensitive and the list is sorted and unique', () => {
        expect(currencyDecimals('cop')).toBe(0)
        expect([...ZERO_DECIMAL_CURRENCIES]).toEqual([...new Set(ZERO_DECIMAL_CURRENCIES)].sort())
    })
    test('moneyStep matches the decimals', () => {
        expect(moneyStep('COP')).toBe(1)
        expect(moneyStep('USD')).toBe(0.01)
    })
})

describe('formatMoney', () => {
    test('COP is the default: whole pesos with Colombian separators', () => {
        expect(plain(formatMoney(35000))).toBe('$ 35.000')
        expect(plain(formatMoney(1250000))).toBe('$ 1.250.000')
        expect(plain(formatMoney(0))).toBe('$ 0')
    })
    test('COP never shows decimals, whatever the locale', () => {
        expect(plain(formatMoney(35000.4, 'COP', 'es-CO'))).toBe('$ 35.000')
        expect(plain(formatMoney(35000, 'COP', 'en-US'))).toBe('COP 35,000')
    })
    test('USD keeps its 2 decimals', () => {
        expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50')
        expect(plain(formatMoney(1234.5, 'USD', 'es-CO'))).toBe('US$ 1.234,50')
    })
    test('uses the given currency and locale', () => {
        expect(plain(formatMoney(1234.5, 'EUR', 'de-DE'))).toBe('1.234,50 €')
        expect(formatMoney(0, 'GBP', 'en-GB')).toBe('£0.00')
    })
    test('rounds to the currency minor unit', () => {
        expect(formatMoney(2.005, 'USD', 'en-US')).toBe('$2.01')
    })
})

describe('roundMoney / hasValidMoneyScale', () => {
    test('rounds half away from zero to the currency decimals, without float noise', () => {
        expect(roundMoney(1.005, 'USD')).toBe(1.01)
        expect(roundMoney(0.1 + 0.2, 'USD')).toBe(0.3)
        expect(roundMoney(35000.5, 'COP')).toBe(35001)
        expect(roundMoney(35000.49, 'COP')).toBe(35000)
    })
    test('detects prices with more decimals than the currency allows', () => {
        expect(hasValidMoneyScale(35000, 'COP')).toBe(true)
        expect(hasValidMoneyScale(35000.5, 'COP')).toBe(false)
        expect(hasValidMoneyScale(29.99, 'USD')).toBe(true)
        expect(hasValidMoneyScale(29.999, 'USD')).toBe(false)
        expect(hasValidMoneyScale(0.1 + 0.2, 'USD')).toBe(true) // float noise is tolerated
    })
})
