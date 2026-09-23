/**
 * Clears the offline HTML/API caches (public/sw.js: `html-*`, `api-*`). Called on logout so a shared/kiosk device
 * never shows the next person cached screens or API responses from the previous session.
 */
export async function clearOfflineCaches(): Promise<void> {
    if (typeof caches === 'undefined') return
    const keys = await caches.keys()
    await Promise.all(
        keys.filter(key => key.startsWith('html-') || key.startsWith('api-')).map(key => caches.delete(key))
    )
}
