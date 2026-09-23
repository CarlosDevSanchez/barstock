import { afterEach, describe, expect, test } from 'bun:test'
import { setupDom } from '../helpers/dom'

setupDom()
const { renderHook, act, cleanup } = await import('@testing-library/react')
const { useOnlineStatus } = await import('@/hooks/use-online-status')

afterEach(cleanup)

describe('useOnlineStatus', () => {
    test('reflects navigator.onLine and updates on the online/offline events', () => {
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
        const { result } = renderHook(() => useOnlineStatus())
        expect(result.current).toBe(true)

        act(() => {
            Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
            window.dispatchEvent(new Event('offline'))
        })
        expect(result.current).toBe(false)

        act(() => {
            Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
            window.dispatchEvent(new Event('online'))
        })
        expect(result.current).toBe(true)
    })
})
