/**
 * Minimal IndexedDB key-value wrapper: two stores, `snapshot` (the POS catalog read offline, see
 * hooks/use-pos-snapshot.ts) and `outbox` (the offline sale queue, see lib/offline/outbox.ts — F3 in
 * docs/06-roadmap/offline-y-sincronizacion.md). Written by hand instead of adding a dependency for ~50 lines.
 *
 * Every function no-ops (resolves `undefined`/void) when `indexedDB` is unavailable — a private-browsing tab, an
 * old browser, or a non-browser test environment — instead of throwing. Callers always fall back to a live fetch.
 */

const DB_NAME = 'barstock-offline'
const DB_VERSION = 1
const STORES = ['snapshot', 'outbox'] as const
export type StoreName = (typeof STORES)[number]

function available(): boolean {
    return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
            const db = request.result
            for (const store of STORES) {
                if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
    if (!available()) return undefined
    const db = await openDb()
    try {
        return await new Promise<T | undefined>((resolve, reject) => {
            const request = db.transaction(store, 'readonly').objectStore(store).get(key)
            request.onsuccess = () => resolve(request.result as T | undefined)
            request.onerror = () => reject(request.error)
        })
    } finally {
        db.close()
    }
}

export async function idbSet<T>(store: StoreName, key: string, value: T): Promise<void> {
    if (!available()) return
    const db = await openDb()
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            tx.objectStore(store).put(value, key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
    if (!available()) return
    const db = await openDb()
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            tx.objectStore(store).delete(key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
    if (!available()) return []
    const db = await openDb()
    try {
        return await new Promise<T[]>((resolve, reject) => {
            const request = db.transaction(store, 'readonly').objectStore(store).getAll()
            request.onsuccess = () => resolve(request.result as T[])
            request.onerror = () => reject(request.error)
        })
    } finally {
        db.close()
    }
}

/**
 * Wipes the `snapshot` store only (logout on a shared/kiosk device: see clearOfflineCaches, called alongside this).
 * Never touches `outbox`: an unsynced sale belongs to the user, not the device, and must survive their logout —
 * it is sent the next time they sign back in (lib/offline/sync.ts checks `entry.user_id` against the session).
 */
export async function idbClearSnapshot(): Promise<void> {
    if (!available()) return
    const db = await openDb()
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('snapshot', 'readwrite')
            tx.objectStore('snapshot').clear()
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } finally {
        db.close()
    }
}
