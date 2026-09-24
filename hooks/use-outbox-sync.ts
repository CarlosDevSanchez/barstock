import { useEffect, useEffectEvent, useState } from 'react'
import { OUTBOX_CHANGED_EVENT, pendingOutboxCount } from '@/lib/offline/outbox'
import { runSync } from '@/lib/offline/sync'

const POLL_INTERVAL_MS = 60_000

export interface OutboxSyncState {
    /** Queued sales not yet synced (pending, mid-send, or waiting for a session). */
    pendingCount: number
    /** Manual "sync now" (the sync center's own button, F4) — same work as a tick, on demand. */
    syncNow: () => void
}

/**
 * Runs the offline sale queue: on mount, whenever the browser comes back online, and every minute while there is
 * anything to send (a cheap no-op otherwise). Mount once, high in the tree (`components/app-shell.tsx`), so it
 * keeps running no matter which page the cashier is on. See F3, docs/06-roadmap/offline-y-sincronizacion.md.
 */
export function useOutboxSync(): OutboxSyncState {
    const [pendingCount, setPendingCount] = useState(0)

    // useEffectEvent: only the work itself, so callers set state in a `.then` callback, not synchronously in an
    // effect body (mirrors hooks/use-pos-snapshot.ts).
    const sync = useEffectEvent(() => runSync().then(() => pendingOutboxCount()))

    useEffect(() => {
        let cancelled = false
        const tick = () => {
            sync().then(
                count => {
                    if (!cancelled) setPendingCount(count)
                },
                () => {} // best-effort: a failed run just leaves the count as it was
            )
        }
        // A local mutation (checkout queuing a sale, a sync-center retry/discard): just re-read the count, no
        // need to actually attempt a send — the tick/online triggers below already own that.
        const recount = () => {
            pendingOutboxCount().then(
                count => {
                    if (!cancelled) setPendingCount(count)
                },
                () => {}
            )
        }
        tick()
        const interval = setInterval(tick, POLL_INTERVAL_MS)
        window.addEventListener('online', tick)
        window.addEventListener(OUTBOX_CHANGED_EVENT, recount)
        return () => {
            cancelled = true
            clearInterval(interval)
            window.removeEventListener('online', tick)
            window.removeEventListener(OUTBOX_CHANGED_EVENT, recount)
        }
    }, [])

    // Not routed through `sync` (a useEffectEvent): those can only be called from an effect, not a plain handler.
    const syncNow = () => {
        runSync()
            .then(() => pendingOutboxCount())
            .then(setPendingCount, () => {})
    }

    return { pendingCount, syncNow }
}
