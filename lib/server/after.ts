import { after as nextAfter } from 'next/server'

/**
 * Run `task` after the response is sent (Next `after`).
 * Integration tests call route handlers outside a request scope; fall back to fire-and-forget there.
 */
export function afterResponse(task: () => void | Promise<void>): void {
    try {
        nextAfter(() => {
            void Promise.resolve(task())
        })
    } catch {
        void Promise.resolve(task())
    }
}
