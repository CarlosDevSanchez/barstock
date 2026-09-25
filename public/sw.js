// Hand-written service worker (no Serwist: its Turbopack/Next 16 integration is unverified, see AGENTS.md).
// Bump this on every change that must invalidate old caches.
const CACHE_VERSION = 'v1'
const STATIC_CACHE = `static-${CACHE_VERSION}`
const HTML_CACHE = `html-${CACHE_VERSION}`
const API_CACHE = `api-${CACHE_VERSION}`
const IMAGE_CACHE = `images-${CACHE_VERSION}`
const CACHES = [STATIC_CACHE, HTML_CACHE, API_CACHE, IMAGE_CACHE]

const OFFLINE_URL = '/offline.html'
const PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']

// R2/MinIO signed image URLs: cache-first, with a simple max age (the URL itself expires in 12h; this is just an
// upper bound so a stale cached image doesn't outlive its own signature by much).
const IMAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000
const IMAGE_HOSTS = ['r2.cloudflarestorage.com', 'localhost:9000', '127.0.0.1:9000']

self.addEventListener('install', event => {
    // Does NOT call skipWaiting(): a new version waits until the app asks for it (sw-register.tsx), so an open
    // tab is never yanked to new code mid-session without the "Update available" toast being acted on.
    event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS)))
})

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(key => !CACHES.includes(key)).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    )
})

self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

// A same-user-only cache: cleared from the app on logout (caches.delete) and here if `/api/v1/me` reports someone
// else, so a shared/kiosk device never serves one cashier's cached screens to the next.
let lastKnownUserId
async function forgetCacheIfUserChanged(response) {
    try {
        const body = await response.clone().json()
        const userId = body?.data?.id
        if (userId && lastKnownUserId && userId !== lastKnownUserId) {
            await Promise.all([caches.delete(HTML_CACHE), caches.delete(API_CACHE)])
        }
        if (userId) lastKnownUserId = userId
    } catch {
        // Not JSON, or no body: nothing to compare.
    }
}

function isImageRequest(url) {
    return IMAGE_HOSTS.some(host => url.host === host || url.host.endsWith(`.${host}`))
}

async function networkFirst(request, cacheName, fallbackUrl) {
    try {
        const response = await fetch(request)
        if (response.ok) {
            const cache = await caches.open(cacheName)
            cache.put(request, response.clone())
        }
        return response
    } catch {
        const cache = await caches.open(cacheName)
        const cached = await cache.match(request)
        if (cached) {
            const headers = new Headers(cached.headers)
            headers.set('X-From-Cache', '1')
            return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers })
        }
        if (fallbackUrl) return caches.match(fallbackUrl)
        return Response.error()
    }
}

async function cacheFirst(request, cacheName, { maxAgeMs } = {}) {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(request)
    if (cached) {
        const cachedAt = Number(cached.headers.get('X-Cached-At') ?? 0)
        if (!maxAgeMs || Date.now() - cachedAt < maxAgeMs) return cached
    }
    try {
        const response = await fetch(request)
        if (response.ok) {
            const headers = new Headers(response.headers)
            headers.set('X-Cached-At', String(Date.now()))
            const stored = new Response(await response.clone().arrayBuffer(), {
                status: response.status,
                statusText: response.statusText,
                headers
            })
            cache.put(request, stored)
        }
        return response
    } catch {
        return cached ?? Response.error()
    }
}

self.addEventListener('fetch', event => {
    const { request } = event
    const url = new URL(request.url)

    // Only GET is ever intercepted or cached: writes must always hit the network (or fail explicitly).
    if (request.method !== 'GET') return

    // Auth endpoints and pages are never cached: serving a stale login/session state would be worse than failing.
    if (url.pathname.startsWith('/api/v1/auth/') || url.pathname.startsWith('/auth/')) return

    if (isImageRequest(url)) {
        event.respondWith(cacheFirst(request, IMAGE_CACHE, { maxAgeMs: IMAGE_MAX_AGE_MS }))
        return
    }

    if (url.origin !== self.location.origin) return

    if (url.pathname.startsWith('/_next/static/')) {
        event.respondWith(cacheFirst(request, STATIC_CACHE))
        return
    }

    if (url.pathname.startsWith('/api/v1/')) {
        event.respondWith(
            networkFirst(request, API_CACHE).then(response => {
                if (url.pathname === '/api/v1/me') event.waitUntil(forgetCacheIfUserChanged(response.clone()))
                return response
            })
        )
        return
    }

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, HTML_CACHE, OFFLINE_URL))
        return
    }
})

self.addEventListener('push', event => {
    let data = { title: 'Barstock', body: '', url: '/' }
    try {
        if (event.data) data = { ...data, ...event.data.json() }
    } catch {
        // Non-JSON payload: keep defaults.
    }
    event.waitUntil(
        self.registration.showNotification(data.title || 'Barstock', {
            body: data.body || '',
            data: { url: data.url || '/' }
        })
    )
})

self.addEventListener('notificationclick', event => {
    event.notification.close()
    const url = event.notification.data?.url || '/'
    event.waitUntil(clients.openWindow(url))
})
