import { describe, expect, test } from 'bun:test'
import { idbClearSnapshot, idbGet, idbGetAll, idbSet } from './db'

// This suite runs under plain `bun test` (test:unit), which has no `indexedDB` global — exactly the "unavailable"
// case (also a private-browsing tab or an old browser) the module is written to degrade gracefully for.
describe('offline db (no indexedDB available)', () => {
    test('idbGet resolves undefined instead of throwing', async () => {
        expect(await idbGet('snapshot', 'anything')).toBeUndefined()
    })

    test('idbSet resolves without writing anything', async () => {
        await expect(idbSet('snapshot', 'anything', { some: 'value' })).resolves.toBeUndefined()
    })

    test('idbGetAll resolves an empty array', async () => {
        expect(await idbGetAll('outbox')).toEqual([])
    })

    test('idbClearSnapshot resolves without throwing', async () => {
        await expect(idbClearSnapshot()).resolves.toBeUndefined()
    })
})
