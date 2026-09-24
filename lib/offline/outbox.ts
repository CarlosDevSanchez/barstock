import type { PaymentMethod } from '@/types'
import { idbDelete, idbGet, idbGetAll, idbSet } from './db'

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

/** Entries a sync run would still try to send, oldest first (FIFO). */
export async function retryableOutboxEntries(): Promise<OutboxEntry[]> {
    const entries = await listOutboxEntries()
    return entries.filter(entry => RETRYABLE.has(entry.state)).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Pending, syncing or waiting for a session — the count that gates the logout warning. */
export async function pendingOutboxCount(): Promise<number> {
    return (await retryableOutboxEntries()).length
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

/** Removes an entry for good (the sync center's "discard", after a `ConfirmDialog`). This is local-only: a
 * discarded entry never reached the server, so there is nothing to undo there — the reason the cashier gives is
 * shown in the confirmation only, not stored anywhere, since there is no order to attach it to. */
export async function discardOutboxEntry(clientRef: string): Promise<void> {
    await idbDelete('outbox', clientRef)
    notifyChanged()
}
