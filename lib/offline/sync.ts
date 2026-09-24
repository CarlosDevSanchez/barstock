import { apiGet, ApiError } from '@/lib/api/client'
import { salesApi, type OrderDetail } from '@/lib/api/orders'
import type { SessionUser } from '@/components/session-provider'
import { retryableOutboxEntries, updateOutboxEntry, type OutboxEntry } from './outbox'

const LOCK_NAME = 'barstock-outbox'
const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 30 * 60_000

function backoffUntil(attempts: number): string {
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS)
    return new Date(Date.now() + delay).toISOString()
}

function isDue(entry: OutboxEntry): boolean {
    return !entry.next_attempt_at || Date.parse(entry.next_attempt_at) <= Date.now()
}

/** Sends one queued sale. Returns false when the run should stop (no session, no network, a 5xx): retrying the
 * rest of the queue right now would not help. Returns true when it is safe to move on to the next entry. */
async function syncEntry(entry: OutboxEntry): Promise<boolean> {
    await updateOutboxEntry(entry.client_ref, { state: 'syncing' })
    try {
        const order: OrderDetail = await salesApi.create(
            {
                customer_id: entry.payload.customer_id,
                payment_method: entry.payload.payment_method,
                discount: entry.payload.discount,
                items: entry.payload.items,
                occurred_at: entry.created_at,
                expected_total: entry.expected_total
            },
            entry.client_ref,
            { redirectOnUnauthorized: false }
        )
        await updateOutboxEntry(entry.client_ref, {
            state: order.sync_issues ? 'synced_with_issues' : 'synced',
            order_id: order.id,
            last_error: undefined
        })
        return true
    } catch (error) {
        if (error instanceof ApiError) {
            if (error.status === 401) {
                await updateOutboxEntry(entry.client_ref, { state: 'paused_auth', last_error: error.message })
                return false
            }
            if (error.status === 0 || error.status === 429 || error.status >= 500) {
                const attempts = entry.attempts + 1
                await updateOutboxEntry(entry.client_ref, {
                    state: 'pending',
                    attempts,
                    next_attempt_at: backoffUntil(attempts),
                    last_error: error.message
                })
                return false
            }
            // A real business rejection (validation, an unavailable product): this entry is done, but the queue
            // is not blocked — carry on with the rest.
            await updateOutboxEntry(entry.client_ref, { state: 'rejected', last_error: error.message })
            return true
        }
        // Unexpected failure (not an ApiError): treat like a hiccup, never drop the entry.
        const attempts = entry.attempts + 1
        await updateOutboxEntry(entry.client_ref, {
            state: 'pending',
            attempts,
            next_attempt_at: backoffUntil(attempts),
            last_error: error instanceof Error ? error.message : String(error)
        })
        return false
    }
}

async function syncOutbox(): Promise<void> {
    const entries = (await retryableOutboxEntries()).filter(isDue)
    if (entries.length === 0) return

    let me: SessionUser
    try {
        me = await apiGet<SessionUser>('me', undefined, undefined, { redirectOnUnauthorized: false })
    } catch {
        return // no session (or actually offline): nothing to send right now
    }

    for (const entry of entries) {
        // Belongs to someone else's session (a shared till, a different user signed in since): leave it queued
        // for when its owner is back.
        if (entry.user_id !== me.id) continue
        const shouldContinue = await syncEntry(entry)
        if (!shouldContinue) return
    }
}

/**
 * Runs the outbox once. Serialized across tabs with the Web Locks API (FIFO: a second call queues behind the
 * first instead of racing it) where the browser supports it; falls back to running inline otherwise — safe either
 * way, since every send carries an idempotency key. Call this from `hooks/use-outbox-sync.ts`, not directly.
 */
export async function runSync(): Promise<void> {
    if (typeof navigator === 'undefined') return
    if (navigator.locks?.request) {
        await navigator.locks.request(LOCK_NAME, syncOutbox)
    } else {
        await syncOutbox()
    }
}
