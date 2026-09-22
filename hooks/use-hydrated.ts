import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * False on the server and during hydration, true afterwards. Forms must not submit before React has attached its handler:
 * the browser would fall back to a native GET and put the fields (a password!) in the URL.
 */
export function useHydrated(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => true,
        () => false
    )
}
