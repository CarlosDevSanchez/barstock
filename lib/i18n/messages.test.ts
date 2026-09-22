import { describe, expect, test } from 'bun:test'
import en from '../../messages/en.json'
import es from '../../messages/es.json'

function keysOf(value: unknown, prefix = ''): string[] {
    if (value === null || typeof value !== 'object') return [prefix]
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        keysOf(child, prefix ? `${prefix}.${key}` : key)
    )
}

describe('message dictionaries', () => {
    test('es and en expose the same keys', () => {
        expect(keysOf(es).sort()).toEqual(keysOf(en).sort())
    })
})
