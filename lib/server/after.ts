import { after as nextAfter } from 'next/server'

/**
 * Run `task` after the response is sent (Next `after`).
 * Integration tests call route handlers outside a request scope; fall back to fire-and-forget there.
 *
 * D1 (F1): `after()` must receive the task's own promise, not a wrapper that already resolved — Vercel keeps the
 * serverless function alive only until the callback passed to `after()` settles. Wrapping it in
 * `void Promise.resolve(task())` handed back an already-resolved promise, so the platform could freeze/kill the
 * function while `task()` was still running, silently dropping the outbox dispatch.
 */
export function afterResponse(task: () => void | Promise<void>): void {
    try {
        nextAfter(() => task())
    } catch {
        void Promise.resolve(task()).catch(error => console.error('[afterResponse] task failed', error))
    }
}
