import { useEffect, useEffectEvent, useState } from 'react'

interface PageResult<T> {
    data: T[]
    total: number
}

export interface InfiniteApiList<T> {
    /** All items loaded so far, across every page, de-duplicated by id. */
    items: T[]
    total: number
    /** True while the first page (of the current key) has not settled yet. */
    loading: boolean
    /** True while a next page is being fetched (the first page already has data). */
    loadingMore: boolean
    error: Error | undefined
    hasMore: boolean
    loadMore: () => void
    /** Restarts at page 1 with the same key (e.g. after a checkout that may have changed stock). */
    reload: () => void
}

interface Attempt {
    requestKey: string
    page: number
}

interface Loaded<T> extends Attempt {
    items: T[]
    total: number
}

interface Failed extends Attempt {
    error: Error
}

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))
const sameAttempt = (a: Attempt, b: Attempt) => a.requestKey === b.requestKey && a.page === b.page

function dedupeById<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>()
    const result: T[] = []
    for (const item of items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        result.push(item)
    }
    return result
}

/**
 * Accumulates pages of a paginated list as `loadMore` is called (infinite scroll). Restarts at page 1 whenever `key`
 * changes (put every filter the query depends on in it, e.g. `JSON.stringify({ search, category })`) or `reload` runs.
 * Mirrors `useApiQuery`'s AbortController + stale-response guard, so a fast filter change never lets an old page land
 * after a newer one.
 */
export function useInfiniteApiList<T extends { id: string }>(
    fetchPage: (page: number, pageSize: number, signal: AbortSignal) => Promise<PageResult<T>>,
    key: string,
    pageSize = 30
): InfiniteApiList<T> {
    const [reloads, setReloads] = useState(0)
    const requestKey = `${key}#${reloads}`

    // A new key (or a reload) starts over at page 1. This adjusts state during render instead of in an effect
    // (React's documented alternative when an effect would only mirror a prop/key change into state).
    const [wanted, setWanted] = useState<Attempt>({ requestKey, page: 1 })
    if (wanted.requestKey !== requestKey) setWanted({ requestKey, page: 1 })

    const [loaded, setLoaded] = useState<Loaded<T>>()
    const [failed, setFailed] = useState<Failed>()

    // useEffectEvent reads the latest `fetchPage` without making the effect depend on its identity.
    const run = useEffectEvent((page: number, signal: AbortSignal) => fetchPage(page, pageSize, signal))

    useEffect(() => {
        if (wanted.requestKey !== requestKey) return // waiting for the render-time reset above to land
        const controller = new AbortController()
        run(wanted.page, controller.signal).then(
            ({ data, total }) => {
                setLoaded(prev => ({
                    requestKey,
                    page: wanted.page,
                    total,
                    items: dedupeById(
                        wanted.page === 1 || prev?.requestKey !== requestKey ? data : [...prev.items, ...data]
                    )
                }))
            },
            (error: unknown) => {
                if (controller.signal.aborted) return
                setFailed({ requestKey, page: wanted.page, error: toError(error) })
            }
        )
        return () => controller.abort()
    }, [requestKey, wanted])

    const forCurrentKey = loaded?.requestKey === requestKey
    const items = forCurrentKey ? loaded.items : []
    const total = forCurrentKey ? loaded.total : 0
    const settled = forCurrentKey && loaded.page === wanted.page
    const loading = wanted.page === 1 && !settled
    const loadingMore = wanted.page > 1 && !settled
    const hasMore = forCurrentKey && items.length < total
    const error = failed && sameAttempt(failed, wanted) ? failed.error : undefined

    return {
        items,
        total,
        loading,
        loadingMore,
        error,
        hasMore,
        loadMore: () => {
            if (!loading && !loadingMore && hasMore) setWanted(prev => ({ ...prev, page: prev.page + 1 }))
        },
        reload: () => setReloads(count => count + 1)
    }
}
