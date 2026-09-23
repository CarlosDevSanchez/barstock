'use client'

import type { ComponentProps } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOnlineStatus } from '@/hooks/use-online-status'

/**
 * A write action (POS checkout, tab items/payments, inventory adjustments): disabled while offline, with a tooltip
 * explaining why. `navigator.onLine` is a hint, not a guarantee the API is reachable — a click that still fails
 * server-side surfaces the usual `network_offline` error toast (lib/api/client.ts).
 */
export function OfflineDisabledButton({ disabled, ...props }: ComponentProps<typeof Button>) {
    const t = useTranslations('connection')
    const online = useOnlineStatus()

    if (online) return <Button disabled={disabled} {...props} />

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* A disabled button swallows pointer events, so the tooltip needs this wrapper to still receive them. */}
                <span className="block w-full">
                    <Button disabled {...props} className={`pointer-events-none ${props.className ?? ''}`} />
                </span>
            </TooltipTrigger>
            <TooltipContent>{t('offlineActionDisabled')}</TooltipContent>
        </Tooltip>
    )
}
