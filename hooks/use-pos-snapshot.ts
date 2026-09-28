import { useEffect, useEffectEvent, useState } from 'react'
import { posApi, type PosSnapshot } from '@/lib/api/pos'
import { idbGet, idbSet } from '@/lib/offline/db'

const STORE_KEY = 'pos-snapshot'
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export interface PosSnapshotState {
    /** The last snapshot available, from a live fetch or (offline) from IndexedDB. Undefined until either lands. */
    data: PosSnapshot | undefined
    /** Fetches now instead of waiting for the next interval/online tick; a manual "sync now" affordance. */
    refresh: () => void
}

/**
 * Keeps a copy of the POS catalog (products, promotions, categories, active customers) available without a network
 * round trip: refreshed on mount, every `REFRESH_INTERVAL_MS` and whenever the browser comes back online, and
 * persisted to IndexedDB so it survives a reload and is there the moment the page mounts offline. See F1 in
 * docs/06-roadmap/offline-y-sincronizacion.md. Checkout itself still needs a live request; this only backs browsing
 * and cart preview.
 */
export function usePosSnapshot(): PosSnapshotState {
    const [data, setData] = useState<PosSnapshot>()
    const [reloads, setReloads] = useState(0)

    useEffect(() => {
        let cancelled = false
        idbGet<PosSnapshot>('snapshot', STORE_KEY).then(
            cached => {
                if (!cancelled && cached) setData(current => current ?? cached)
            },
            () => {}
        )
        return () => {
            cancelled = true
        }
    }, [])

    // useEffectEvent: only the fetch itself, so the effect below does its setState in a `.then` callback, not
    // synchronously in the effect body.
    const fetchSnapshot = useEffectEvent(() => posApi.snapshot())

    useEffect(() => {
        let cancelled = false
        const fetchNow = () => {
            fetchSnapshot().then(
                snapshot => {
                    if (cancelled) return
                    setData(snapshot)
                    void idbSet('snapshot', STORE_KEY, snapshot)
                },
                () => {} // offline, or the request failed: keep whatever is already loaded
            )
        }
        fetchNow()
        const interval = setInterval(fetchNow, REFRESH_INTERVAL_MS)
        window.addEventListener('online', fetchNow)
        return () => {
            cancelled = true
            clearInterval(interval)
            window.removeEventListener('online', fetchNow)
        }
    }, [reloads])

    return { data, refresh: () => setReloads(count => count + 1) }
}
