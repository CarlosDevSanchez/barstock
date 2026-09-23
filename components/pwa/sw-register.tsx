'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

/** Registers public/sw.js in production only: a dev-mode SW would cache Turbopack's ever-changing output. */
export function ServiceWorkerRegister() {
    const t = useTranslations('pwa')

    useEffect(() => {
        if (process.env.NODE_ENV !== 'production') return
        if (!('serviceWorker' in navigator)) return

        // `clients.claim()` in the SW's activate handler (public/sw.js) fires `controllerchange` even on the very
        // FIRST install of a page that had no controller yet — that is not an update, and must not reload the page.
        // Only reload when an existing controller is being REPLACED by a new one.
        let hadController = Boolean(navigator.serviceWorker.controller)
        let reloading = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hadController) {
                hadController = true
                return
            }
            if (reloading) return
            reloading = true
            window.location.reload()
        })

        navigator.serviceWorker
            .register('/sw.js')
            .then(registration => {
                registration.addEventListener('updatefound', () => {
                    const installing = registration.installing
                    if (!installing) return
                    installing.addEventListener('statechange', () => {
                        // "installed" + an existing controller means this is an UPDATE, not the first install.
                        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                            toast(t('updateAvailable'), {
                                duration: Infinity,
                                action: { label: t('update'), onClick: () => installing.postMessage('SKIP_WAITING') }
                            })
                        }
                    })
                })
            })
            .catch(error => console.error('[pwa] service worker registration failed', error))
    }, [t])

    return null
}
