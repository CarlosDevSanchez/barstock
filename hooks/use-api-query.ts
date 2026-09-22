import { useEffect, useEffectEvent, useState } from 'react'

interface Result<T> {
    key: string
    data?: T
    error?: Error
}

export interface ApiQuery<T> {
    /** Last successful data; kept while a newer request is in flight so lists do not flash empty. */
    data: T | undefined
    /** True while the request for the current `key` has not settled. */
    loading: boolean
    /** Error of the current request (cleared when the key changes). */
    error: Error | undefined
    reload: () => void
}

/**
 * Fetches when `key` changes (put every input of the request in it, e.g. `JSON.stringify({ page, q })`), cancels the
 * previous request, ignores stale responses, and never calls setState synchronously inside the effect.
 */
export function useApiQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string): ApiQuery<T> {
    const [result, setResult] = useState<Result<T>>()
    const [reloads, setReloads] = useState(0)
    const requestKey = `${key}#${reloads}`
    // useEffectEvent reads the latest `fetcher` without making the effect depend on its identity.
    const run = useEffectEvent((signal: AbortSignal) => fetcher(signal))

    useEffect(() => {
        const controller = new AbortController()
        run(controller.signal).then(
            data => setResult({ key: requestKey, data }),
            (error: unknown) => {
                if (controller.signal.aborted) return
                setResult({ key: requestKey, error: error instanceof Error ? error : new Error(String(error)) })
            }
        )
        return () => controller.abort()
    }, [requestKey])

    const settled = result?.key === requestKey
    return {
        data: result?.data,
        loading: !settled,
        error: settled ? result.error : undefined,
        reload: () => setReloads(count => count + 1)
    }
}
