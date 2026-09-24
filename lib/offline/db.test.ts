import { describe, expect, test } from 'bun:test'
import { idbClearSnapshot, idbGet, idbGetAll, idbSet } from './db'

// Runs in its OWN process (see test:unit / test:coverage path-ignore). outbox.test.ts and sync.test.ts call
// mock.module('@/lib/offline/db', …); that mock is process-global, so sharing a process with them makes this
// file exercise the in-memory fake (and whatever outbox rows they left) instead of the real no-indexedDB
// degradation path — order-dependent, and the order on CI (sync → db) is not the order on a Mac (db → sync).
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
