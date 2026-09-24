import { useEffect, useEffectEvent, useState } from 'react'
import { pendingOutboxCount } from '@/lib/offline/outbox'
import { runSync } from '@/lib/offline/sync'

const POLL_INTERVAL_MS = 60_000

export interface OutboxSyncState {
    /** Queued sales not yet synced (pending, mid-send, or waiting for a session). */
    pendingCount: number
}

/**
 * Runs the offline sale queue: on mount, whenever the browser comes back online, and every minute while there is
 * anything to send (a cheap no-op otherwise). Mount once, high in the tree (`components/app-shell.tsx`), so it
 * keeps running no matter which page the cashier is on. See F3, docs/06-roadmap/offline-y-sincronizacion.md.
 */
export function useOutboxSync(): OutboxSyncState {
    const [pendingCount, setPendingCount] = useState(0)

    // useEffectEvent: only the work itself, so the effect below sets state in a `.then` callback, not
    // synchronously in the effect body (mirrors hooks/use-pos-snapshot.ts).
    const sync = useEffectEvent(() => runSync().then(pendingOutboxCount))

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
        tick()
        const interval = setInterval(tick, POLL_INTERVAL_MS)
        window.addEventListener('online', tick)
        return () => {
            cancelled = true
            clearInterval(interval)
            window.removeEventListener('online', tick)
        }
    }, [])

    return { pendingCount }
}
