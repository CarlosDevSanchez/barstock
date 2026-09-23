import { describe, expect, test } from 'bun:test'
import { suggestSku } from './sku'

describe('suggestSku', () => {
    test('the plan example: up to 3 letters per word, numeric words kept whole', () => {
        expect(suggestSku('Cerveza Club Colombia 330ml')).toBe('CER-CLU-COL-330ML')
    })

    test('strips accents before building the SKU', () => {
        expect(suggestSku('Café Orgánico')).toBe('CAF-ORG')
    })

    test('uppercases and drops punctuation, keeping only [A-Z0-9]', () => {
        expect(suggestSku("O'Brien's Sauce, 1L")).toBe('OBR-SAU-1L')
    })

    test('short names (fewer than 3-4 words) use whatever words exist', () => {
        expect(suggestSku('Agua')).toBe('AGU')
        expect(suggestSku('Agua Mineral')).toBe('AGU-MIN')
    })

    test('only the first 4 words contribute, extra words are ignored', () => {
        expect(suggestSku('Uno Dos Tres Cuatro Cinco Seis')).toBe('UNO-DOS-TRE-CUA')
    })

    test('collapses repeated whitespace between words', () => {
        expect(suggestSku('  Agua   Mineral  ')).toBe('AGU-MIN')
    })

    test('a fully numeric word is kept whole, not truncated to 3 characters', () => {
        expect(suggestSku('Producto 123456')).toBe('PRO-123456')
    })

    test('is capped at 64 characters', () => {
        const sku = suggestSku(
            'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 111111111111111111111111111111'
        )
        expect(sku.length).toBeLessThanOrEqual(64)
    })

    test('an empty or blank name yields an empty SKU', () => {
        expect(suggestSku('')).toBe('')
        expect(suggestSku('   ')).toBe('')
    })
})
