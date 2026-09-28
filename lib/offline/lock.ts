const LOCK_NAME = 'barstock-outbox'

/**
 * Serializes access to the outbox (queue state, not the sale itself — every send still carries an idempotency key)
 * across tabs with the Web Locks API where the browser supports it; runs `fn` inline otherwise. Shared by
 * `lib/offline/sync.ts` (a full sync run) and `discardOutboxEntry` (F4, `components/offline/sync-center.tsx`): a
 * discard has to see the same in-flight state a concurrent sync would, or a manager can discard an entry the
 * instant after it started sending — the local state says "gone", the server still gets the sale.
 */
export async function withOutboxLock<T>(fn: () => Promise<T>): Promise<T> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) return fn()
    return navigator.locks.request(LOCK_NAME, fn)
}
