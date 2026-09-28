import { describe, expect, test } from 'bun:test'
import { idbClearSnapshot, idbGet, idbGetAll, idbSet } from '@/lib/offline/db'

// Lives under test/offline/ (not lib/) so `bun test lib stores` never co-loads it with outbox.test.ts /
// sync.test.ts. Those files call mock.module('@/lib/offline/db', …); that mock is process-global, so sharing
// a process makes this suite exercise the in-memory fake (and leftover outbox rows) instead of the real
// no-indexedDB degradation path. File discovery order also differs across OSes (CI Linux: sync → db).
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
