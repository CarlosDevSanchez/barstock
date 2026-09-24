import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { setupDom } from '../helpers/dom'

setupDom()
const { renderHook, waitFor, act, cleanup } = await import('@testing-library/react')

const emptySnapshot = {
    generated_at: '2026-01-01T00:00:00Z',
    products: [],
    promotions: [],
    categories: [],
    customers: []
}

const snapshot = mock(async () => emptySnapshot)
void mock.module('@/lib/api/pos', () => ({ posApi: { snapshot } }))

const { usePosSnapshot } = await import('@/hooks/use-pos-snapshot')

beforeEach(() => {
    snapshot.mockClear()
    snapshot.mockImplementation(async () => emptySnapshot)
})
afterEach(cleanup)

describe('usePosSnapshot', () => {
    test('fetches on mount and exposes the result', async () => {
        const { result } = renderHook(() => usePosSnapshot())
        expect(result.current.data).toBeUndefined()
        await waitFor(() => expect(result.current.data).toEqual(emptySnapshot))
        expect(snapshot).toHaveBeenCalledTimes(1)
    })

    test('a failed fetch (offline) keeps whatever was already loaded instead of clearing it', async () => {
        const { result } = renderHook(() => usePosSnapshot())
        await waitFor(() => expect(result.current.data).toEqual(emptySnapshot))

        snapshot.mockImplementationOnce(async () => {
            throw new Error('network_offline')
        })
        act(() => result.current.refresh())
        await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2))
        expect(result.current.data).toEqual(emptySnapshot)
    })

    test('refresh() fetches again on demand', async () => {
        const { result } = renderHook(() => usePosSnapshot())
        await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1))
        act(() => result.current.refresh())
        await waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2))
    })
})
