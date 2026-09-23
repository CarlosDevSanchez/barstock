'use client'

import { useCallback, useEffect, useState } from 'react'
import { useHydrated } from '@/hooks/use-hydrated'

const DISMISS_KEY = 'barstock-pwa-install-dismissed'

/** Minimal shape of Chromium's BeforeInstallPromptEvent (not in lib.dom yet everywhere). */
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type PwaInstallMode = 'prompt' | 'ios'

function isStandalone(): boolean {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    return Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

function isIosSafari(): boolean {
    const ua = navigator.userAgent
    // iPadOS 13+ reports as MacIntel with touch points.
    const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    return /iPad|iPhone|iPod/.test(ua) || iPadOs
}

function readDismissed(): boolean {
    try {
        return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
        return false
    }
}

function writeDismissed(): void {
    try {
        localStorage.setItem(DISMISS_KEY, '1')
    } catch {
        /* ignore quota / private mode */
    }
}

export function usePwaInstall() {
    const hydrated = useHydrated()
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => {
        const onBeforeInstall = (event: Event) => {
            event.preventDefault()
            setDeferred(event as BeforeInstallPromptEvent)
        }
        window.addEventListener('beforeinstallprompt', onBeforeInstall)
        return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    }, [])

    const standalone = hydrated && isStandalone()
    const ios = hydrated && isIosSafari()
    const mode: PwaInstallMode | null = deferred ? 'prompt' : ios ? 'ios' : null
    const visible = hydrated && !standalone && !dismissed && !readDismissed() && mode !== null

    const install = useCallback(async () => {
        if (!deferred) return
        await deferred.prompt()
        const { outcome } = await deferred.userChoice
        setDeferred(null)
        if (outcome === 'accepted') {
            writeDismissed()
            setDismissed(true)
        }
    }, [deferred])

    const dismiss = useCallback(() => {
        writeDismissed()
        setDismissed(true)
    }, [])

    return { visible, mode, install, dismiss }
}
