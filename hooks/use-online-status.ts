import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void) {
    window.addEventListener('online', callback)
    window.addEventListener('offline', callback)
    return () => {
        window.removeEventListener('online', callback)
        window.removeEventListener('offline', callback)
    }
}

function getSnapshot() {
    return navigator.onLine
}

function getServerSnapshot() {
    // The server always renders as "online": the browser corrects it on hydration if it is not.
    return true
}

export function useOnlineStatus(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
