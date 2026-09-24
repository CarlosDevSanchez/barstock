import type { PaymentMethod } from '@/types'
import { idbDelete, idbGet, idbGetAll, idbSet } from './db'
import { withOutboxLock } from './lock'

export type OutboxState = 'pending' | 'syncing' | 'synced' | 'synced_with_issues' | 'rejected' | 'paused_auth'

/** States a sync run still tries to send. Everything else (`synced`, `synced_with_issues`, `rejected`) is terminal. */
const RETRYABLE: ReadonlySet<OutboxState> = new Set(['pending', 'syncing', 'paused_auth'])

/** Fired after every write to the outbox (queue, update, discard). `hooks/use-outbox-sync.ts` listens for this to
 * refresh its count right away — e.g. right after checkout queues a sale — instead of waiting for its next tick
 * (every 60s) or the browser's `online` event. Just a local re-read, not a sync attempt. */
export const OUTBOX_CHANGED_EVENT = 'barstock:outbox-changed'

function notifyChanged(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT))
}

export type OutboxSaleItem =
    | { product_id: string; variant_id?: string | null; quantity: number; discount?: number }
    | { promotion_id: string; quantity: number }

export interface OutboxSalePayload {
    customer_id: string | null
    payment_method: PaymentMethod
    discount: number
    items: OutboxSaleItem[]
}

export interface OutboxEntry {
    /** Also sent as the `Idempotency-Key` header when syncing, and as `orders.client_ref` once synced. */
    client_ref: string
    user_id: string
    /** Device clock at checkout; sent as `occurred_at` — this is when the sale actually happened. */
    created_at: string
    payload: OutboxSalePayload
    /** The POS preview total, shown to the cashier; the server always recomputes it (never trusted as-is). */
    expected_total: number
    /** `OFF-XXXXXXXX`, shown on the provisional ticket until the real `order_number` exists. */
    provisional_number: string
    state: OutboxState
    attempts: number
    /** Backoff gate for `pending` entries after a network/5xx failure; sync skips the entry until this passes. */
    next_attempt_at?: string
    last_error?: string
    /** Set once a sync attempt returns an order (`synced`/`synced_with_issues`). */
    order_id?: string
}

/** Queues a sale rung up without a connection. `clientRef` is the same UUID the POS already generates per checkout
 * attempt (F0's idempotency key): calling this twice with the same one just overwrites the same entry, so a double
 * click before the cart clears can never queue the same sale twice. */
export async function enqueueSale(
    clientRef: string,
    userId: string,
    payload: OutboxSalePayload,
    expectedTotal: number
): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
        client_ref: clientRef,
        user_id: userId,
        created_at: new Date().toISOString(),
        payload,
        expected_total: expectedTotal,
        provisional_number: `OFF-${clientRef.slice(0, 8).toUpperCase()}`,
        state: 'pending',
        attempts: 0
    }
    await idbSet('outbox', clientRef, entry)
    notifyChanged()
    return entry
}

export async function listOutboxEntries(): Promise<OutboxEntry[]> {
    return idbGetAll<OutboxEntry>('outbox')
}

/** Entries a sync run would still try to send, oldest first (FIFO). `userId` narrows to one owner — the logout
 * warning (`components/shell/account-menu.tsx`) only cares about the signed-in cashier's own queue, not a
 * different user's left over on a shared device. */
export async function retryableOutboxEntries(userId?: string): Promise<OutboxEntry[]> {
    const entries = await listOutboxEntries()
    return entries
        .filter(entry => RETRYABLE.has(entry.state) && (userId === undefined || entry.user_id === userId))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Pending, syncing or waiting for a session — the count that gates the logout warning. */
export async function pendingOutboxCount(userId?: string): Promise<number> {
    return (await retryableOutboxEntries(userId)).length
}

export async function updateOutboxEntry(clientRef: string, patch: Partial<OutboxEntry>): Promise<void> {
    const current = await idbGet<OutboxEntry>('outbox', clientRef)
    if (!current) return
    await idbSet('outbox', clientRef, { ...current, ...patch })
    notifyChanged()
}

/** Puts a `rejected` or `paused_auth` entry back in the queue (the sync center's "retry"): the next `runSync()`
 * picks it up again, immediately (no backoff carried over). A no-op for a state that is already retryable. */
export async function retryOutboxEntry(clientRef: string): Promise<void> {
    await updateOutboxEntry(clientRef, { state: 'pending', next_attempt_at: undefined, last_error: undefined })
}

export type DiscardResult = 'discarded' | 'in_progress' | 'already_synced' | 'not_found'

/** Removes an entry for good — the sync center's "discard" (F4), after `PATCH /api/v1/outbox/discard-log` records
 * why (a manager-only, server-validated audit entry: see `components/offline/sync-center.tsx`). Runs inside the
 * same outbox lock a sync run uses (`lib/offline/lock.ts`) and re-reads the entry's state fresh under that lock,
 * rather than trusting whatever the caller last saw: the entry a manager clicked "Discard" on may have started (or
 * finished) syncing in the moment between that click and this call, and deleting it out from under an in-flight
 * `POST /sales` would silence a sale that is actually about to succeed. */
export async function discardOutboxEntry(clientRef: string): Promise<DiscardResult> {
    return withOutboxLock(async () => {
        const current = await idbGet<OutboxEntry>('outbox', clientRef)
        if (!current) return 'not_found'
        if (current.state === 'syncing') return 'in_progress'
        if (current.state === 'synced' || current.state === 'synced_with_issues') return 'already_synced'
        await idbDelete('outbox', clientRef)
        notifyChanged()
        return 'discarded'
    })
}
