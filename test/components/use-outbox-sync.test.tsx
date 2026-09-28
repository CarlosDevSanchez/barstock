import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { setupDom } from '../helpers/dom'

setupDom()
const { renderHook, waitFor, act, cleanup } = await import('@testing-library/react')

const runSync = mock(async () => {})
const pendingOutboxCount = mock(async () => 0)
void mock.module('@/lib/offline/sync', () => ({ runSync }))
void mock.module('@/lib/offline/outbox', () => ({
    pendingOutboxCount,
    OUTBOX_CHANGED_EVENT: 'barstock:outbox-changed'
}))

const { useOutboxSync } = await import('@/hooks/use-outbox-sync')

beforeEach(() => {
    runSync.mockClear()
    pendingOutboxCount.mockClear()
    pendingOutboxCount.mockImplementation(async () => 0)
})
afterEach(cleanup)

describe('useOutboxSync', () => {
    test('runs the outbox on mount and exposes the pending count', async () => {
        pendingOutboxCount.mockImplementation(async () => 2)
        const { result } = renderHook(() => useOutboxSync())
        expect(result.current.pendingCount).toBe(0)
        await waitFor(() => expect(result.current.pendingCount).toBe(2))
        expect(runSync).toHaveBeenCalledTimes(1)
    })

    test('runs again when the browser comes back online', async () => {
        const { result } = renderHook(() => useOutboxSync())
        await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))

        pendingOutboxCount.mockImplementation(async () => 0)
        act(() => {
            window.dispatchEvent(new Event('online'))
        })
        await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2))
        expect(result.current.pendingCount).toBe(0)
    })

    test('a failed run leaves the last known count instead of clearing it', async () => {
        pendingOutboxCount.mockImplementation(async () => 3)
        const { result } = renderHook(() => useOutboxSync())
        await waitFor(() => expect(result.current.pendingCount).toBe(3))

        runSync.mockImplementationOnce(async () => {
            throw new Error('offline')
        })
        act(() => {
            window.dispatchEvent(new Event('online'))
        })
        await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2))
        expect(result.current.pendingCount).toBe(3)
    })

    test('a local outbox change (e.g. checkout queuing a sale) recounts immediately without a full sync', async () => {
        const { result } = renderHook(() => useOutboxSync())
        await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))

        pendingOutboxCount.mockImplementation(async () => 1)
        act(() => {
            window.dispatchEvent(new Event('barstock:outbox-changed'))
        })
        await waitFor(() => expect(result.current.pendingCount).toBe(1))
        expect(runSync).toHaveBeenCalledTimes(1) // still just the mount run, no extra sync attempt
    })

    test('syncNow triggers a sync and updates the count', async () => {
        const { result } = renderHook(() => useOutboxSync())
        await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))

        pendingOutboxCount.mockImplementation(async () => 0)
        act(() => {
            result.current.syncNow()
        })
        await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2))
        expect(result.current.pendingCount).toBe(0)
    })
})
