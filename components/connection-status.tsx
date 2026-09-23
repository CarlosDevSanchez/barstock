'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useOnlineStatus } from '@/hooks/use-online-status'

const OFFLINE_TOAST_ID = 'connection-offline'

/**
 * Always-visible badge in the dashboard header, plus a persistent toast while offline (dismissed automatically on
 * reconnect, replaced by a brief success toast). `navigator.onLine` only reflects the network interface, not whether
 * the API is actually reachable, so this is a UX hint, never the source of truth for whether a write will succeed.
 */
export function ConnectionStatus() {
    const t = useTranslations('connection')
    const online = useOnlineStatus()
    const wasOnline = useRef(online)

    useEffect(() => {
        if (online) {
            if (!wasOnline.current) {
                toast.dismiss(OFFLINE_TOAST_ID)
                toast.success(t('backOnline'))
            }
        } else {
            toast.error(t('offlineToast'), { id: OFFLINE_TOAST_ID, duration: Infinity })
        }
        wasOnline.current = online
    }, [online, t])

    if (online) return null

    return (
        <Badge variant="destructive" className="gap-1.5">
            <WifiOff className="h-3.5 w-3.5" />
            {t('offlineBadge')}
        </Badge>
    )
}
