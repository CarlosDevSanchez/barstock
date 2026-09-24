import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { OutboxEntry } from './outbox'
import { fakeIdbStore, resetFakeIdb } from '../../test/helpers/fake-idb'

class MockApiError extends Error {
    constructor(
        readonly status: number,
        message = 'error'
    ) {
        super(message)
    }
}

const me = mock(async () => ({ id: 'user-1' }))
void mock.module('@/lib/api/client', () => ({ ApiError: MockApiError, apiGet: me }))

const create = mock(async (..._args: unknown[]) => ({ id: 'order-1', sync_issues: null }) as Record<string, unknown>)
void mock.module('@/lib/api/orders', () => ({ salesApi: { create } }))

// Same fake IndexedDB as lib/offline/outbox.test.ts (shared on purpose — see test/helpers/fake-idb.ts): this file
// exercises the real outbox.ts on top of it, not a stand-in for outbox.ts itself, so `runSync`'s real filtering
// (retryable states, FIFO order, per-user matching) is what is actually under test here.
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

const { enqueueSale, updateOutboxEntry, listOutboxEntries } = await import('./outbox')
const { runSync } = await import('./sync')

const payload = {
    customer_id: null,
    payment_method: 'cash' as const,
    discount: 0,
    items: [{ product_id: 'p1', quantity: 1 }]
}

/** Queues a sale and applies any extra fields a real checkout would never set up front (state, next_attempt_at…). */
async function seed(overrides: Partial<OutboxEntry> = {}): Promise<OutboxEntry> {
    const clientRef = overrides.client_ref ?? crypto.randomUUID()
    await enqueueSale(clientRef, overrides.user_id ?? 'user-1', payload, 10)
    if (Object.keys(overrides).length > 0) await updateOutboxEntry(clientRef, overrides)
    const entries = await listOutboxEntries()
    return entries.find(entry => entry.client_ref === clientRef)!
}

const entryFor = async (clientRef: string) => (await listOutboxEntries()).find(entry => entry.client_ref === clientRef)

beforeEach(() => {
    resetFakeIdb()
    me.mockReset()
    me.mockImplementation(async () => ({ id: 'user-1' }))
    create.mockReset()
    create.mockImplementation(async () => ({ id: 'order-1', sync_issues: null }))
})

describe('runSync', () => {
    test('an empty outbox never checks the session', async () => {
        await runSync()
        expect(me).not.toHaveBeenCalled()
        expect(create).not.toHaveBeenCalled()
    })

    test('no session (offline, or signed out): entries stay untouched', async () => {
        me.mockImplementation(async () => {
            throw new Error('network_offline')
        })
        const entry = await seed()
        await runSync()
        expect(create).not.toHaveBeenCalled()
        expect((await entryFor(entry.client_ref))?.state).toBe('pending')
    })

    test('a successful send marks the entry synced and records the order id', async () => {
        const entry = await seed()
        await runSync()
        const final = await entryFor(entry.client_ref)
        expect(final?.state).toBe('synced')
        expect(final).toMatchObject({ order_id: 'order-1' })
    })

    test('a synced order carrying sync_issues becomes synced_with_issues, not synced', async () => {
        create.mockImplementation(async () => ({ id: 'order-2', sync_issues: { stock_shortfall: [] } }))
        const entry = await seed()
        await runSync()
        expect((await entryFor(entry.client_ref))?.state).toBe('synced_with_issues')
    })

    test('a 401 pauses that entry and stops the run: later entries are never attempted', async () => {
        create.mockImplementationOnce(async () => {
            throw new MockApiError(401, 'unauthorized')
        })
        const first = await seed({ created_at: '2026-01-01T00:00:00Z' })
        const second = await seed({ created_at: '2026-01-01T00:00:01Z' })
        await runSync()
        expect((await entryFor(first.client_ref))?.state).toBe('paused_auth')
        expect((await entryFor(second.client_ref))?.state).toBe('pending')
        expect(create).toHaveBeenCalledTimes(1)
    })

    test('a business rejection (4xx) marks that entry rejected and moves on to the next', async () => {
        create.mockImplementationOnce(async () => {
            throw new MockApiError(422, 'Product not available')
        })
        const first = await seed({ created_at: '2026-01-01T00:00:00Z' })
        const second = await seed({ created_at: '2026-01-01T00:00:01Z' })
        await runSync()
        expect((await entryFor(first.client_ref))?.state).toBe('rejected')
        expect((await entryFor(second.client_ref))?.state).toBe('synced')
        expect(create).toHaveBeenCalledTimes(2)
    })

    test('a network/5xx failure keeps the entry pending with backoff, and stops the run', async () => {
        create.mockImplementationOnce(async () => {
            throw new MockApiError(0, 'network_offline')
        })
        const first = await seed({ created_at: '2026-01-01T00:00:00Z' })
        const second = await seed({ created_at: '2026-01-01T00:00:01Z' })
        await runSync()
        const updated = await entryFor(first.client_ref)
        expect(updated?.state).toBe('pending')
        expect(updated?.attempts).toBe(1)
        expect(Date.parse(updated?.next_attempt_at ?? '')).toBeGreaterThan(Date.now())
        expect((await entryFor(second.client_ref))?.state).toBe('pending')
        expect(create).toHaveBeenCalledTimes(1)
    })

    test('an entry belonging to a different user is skipped, not sent', async () => {
        const someoneElses = await seed({ user_id: 'user-2', created_at: '2026-01-01T00:00:00Z' })
        const mine = await seed({ user_id: 'user-1', created_at: '2026-01-01T00:00:01Z' })
        await runSync()
        expect(create).toHaveBeenCalledTimes(1)
        expect((await entryFor(someoneElses.client_ref))?.state).toBe('pending')
        expect((await entryFor(mine.client_ref))?.state).toBe('synced')
    })

    test('an entry whose backoff has not elapsed yet is skipped this run', async () => {
        await seed({ next_attempt_at: new Date(Date.now() + 60_000).toISOString() })
        await runSync()
        expect(me).not.toHaveBeenCalled()
        expect(create).not.toHaveBeenCalled()
    })
})
