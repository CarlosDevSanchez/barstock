import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { fakeIdbStore, resetFakeIdb } from '../../test/helpers/fake-idb'

void mock.module('@/lib/offline/db', () => ({
    idbGet: async (store: string, key: string) => fakeIdbStore(store).get(key),
    idbSet: async (store: string, key: string, value: unknown) => {
        fakeIdbStore(store).set(key, value)
    },
    idbGetAll: async (store: string) => [...fakeIdbStore(store).values()],
    idbDelete: async (store: string, key: string) => {
        fakeIdbStore(store).delete(key)
    }
}))

const {
    discardOutboxEntry,
    enqueueSale,
    listOutboxEntries,
    retryableOutboxEntries,
    pendingOutboxCount,
    updateOutboxEntry
} = await import('./outbox')

const payload = {
    customer_id: null,
    payment_method: 'cash' as const,
    discount: 0,
    items: [{ product_id: 'p1', quantity: 1 }]
}

beforeEach(resetFakeIdb)

describe('outbox', () => {
    test('enqueueSale creates a pending entry with a derived provisional number', async () => {
        const entry = await enqueueSale('a1b2c3d4-0000-0000-0000-000000000000', 'user-1', payload, 25.5)
        expect(entry.state).toBe('pending')
        expect(entry.attempts).toBe(0)
        expect(entry.provisional_number).toBe('OFF-A1B2C3D4')
        expect(entry.expected_total).toBe(25.5)
        expect(await listOutboxEntries()).toContainEqual(entry)
    })

    test('enqueueing the same client_ref twice overwrites instead of duplicating', async () => {
        const clientRef = 'b1111111-0000-0000-0000-000000000001'
        await enqueueSale(clientRef, 'user-1', payload, 10)
        await enqueueSale(clientRef, 'user-1', payload, 10)
        expect((await listOutboxEntries()).filter(entry => entry.client_ref === clientRef)).toHaveLength(1)
    })

    test('retryableOutboxEntries keeps pending/syncing/paused_auth, drops terminal states, oldest first', async () => {
        const pending = await enqueueSale('c0000000-0000-0000-0000-000000000001', 'user-2', payload, 10)
        const synced = await enqueueSale('c0000000-0000-0000-0000-000000000002', 'user-2', payload, 10)
        const rejected = await enqueueSale('c0000000-0000-0000-0000-000000000003', 'user-2', payload, 10)
        await updateOutboxEntry(synced.client_ref, { state: 'synced' })
        await updateOutboxEntry(rejected.client_ref, { state: 'rejected' })

        const retryable = (await retryableOutboxEntries()).filter(entry => entry.user_id === 'user-2')
        expect(retryable.map(entry => entry.client_ref)).toEqual([pending.client_ref])
    })

    test('pendingOutboxCount counts only retryable entries', async () => {
        const before = await pendingOutboxCount()
        const entry = await enqueueSale('d0000000-0000-0000-0000-000000000001', 'user-3', payload, 10)
        expect(await pendingOutboxCount()).toBe(before + 1)
        await updateOutboxEntry(entry.client_ref, { state: 'synced' })
        expect(await pendingOutboxCount()).toBe(before)
    })

    test('updateOutboxEntry merges the patch and no-ops for an unknown client_ref', async () => {
        const entry = await enqueueSale('e0000000-0000-0000-0000-000000000001', 'user-4', payload, 10)
        await updateOutboxEntry(entry.client_ref, { state: 'rejected', last_error: 'boom' })
        const [updated] = await listOutboxEntries().then(entries =>
            entries.filter(e => e.client_ref === entry.client_ref)
        )
        expect(updated).toMatchObject({ state: 'rejected', last_error: 'boom', expected_total: 10 })

        await updateOutboxEntry('does-not-exist', { state: 'rejected' })
        expect((await listOutboxEntries()).some(e => e.client_ref === 'does-not-exist')).toBe(false)
    })

    describe('discardOutboxEntry', () => {
        // The one thing the sync center gets wrong if this ever regresses: a manager discarding an entry the
        // instant it starts (or finishes) sending, silencing a sale that actually reached the server. Re-reads
        // the entry's own state fresh rather than trusting whatever a caller (the sync-center component) last saw.
        test('a rejected/pending/paused_auth entry is removed and reports "discarded"', async () => {
            for (const state of ['rejected', 'pending', 'paused_auth'] as const) {
                const entry = await enqueueSale(crypto.randomUUID(), 'user-5', payload, 10)
                await updateOutboxEntry(entry.client_ref, { state })
                expect(await discardOutboxEntry(entry.client_ref)).toBe('discarded')
                expect((await listOutboxEntries()).some(e => e.client_ref === entry.client_ref)).toBe(false)
            }
        })

        test('a syncing entry is left alone and reports "in_progress"', async () => {
            const entry = await enqueueSale(crypto.randomUUID(), 'user-5', payload, 10)
            await updateOutboxEntry(entry.client_ref, { state: 'syncing' })
            expect(await discardOutboxEntry(entry.client_ref)).toBe('in_progress')
            expect((await listOutboxEntries()).some(e => e.client_ref === entry.client_ref)).toBe(true)
        })

        test('a synced/synced_with_issues entry is left alone and reports "already_synced"', async () => {
            for (const state of ['synced', 'synced_with_issues'] as const) {
                const entry = await enqueueSale(crypto.randomUUID(), 'user-5', payload, 10)
                await updateOutboxEntry(entry.client_ref, { state })
                expect(await discardOutboxEntry(entry.client_ref)).toBe('already_synced')
                expect((await listOutboxEntries()).some(e => e.client_ref === entry.client_ref)).toBe(true)
            }
        })

        test('an unknown client_ref reports "not_found"', async () => {
            expect(await discardOutboxEntry('does-not-exist')).toBe('not_found')
        })
    })
})
