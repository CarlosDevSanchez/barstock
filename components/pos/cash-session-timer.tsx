'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Timer } from 'lucide-react'
import { useSession } from '@/components/session-provider'
import { moneyLocale } from '@/lib/i18n/config'
import { cn } from '@/lib/utils'

/** After this long the till reads as overdue: nudge the cashier to count and close it. */
export const LONG_SESSION_HOURS = 12

/** `HH:MM:SS` since `openedAt`; hours keep counting past 24. Clock skew never shows a negative time. */
export function formatElapsed(openedAt: string, now: number): string {
    const seconds = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 1000))
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
}

/** A small live pill in the POS header: which till is open, for how long, and a shortcut to close it in /cash. */
export function CashSessionTimer({ registerName, openedAt }: { registerName: string; openedAt: string }) {
    const t = useTranslations('pos')
    const locale = useLocale()
    const { settings } = useSession()
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(interval)
    }, [])

    const elapsed = formatElapsed(openedAt, now)
    const overdue = now - new Date(openedAt).getTime() >= LONG_SESSION_HOURS * 3_600_000
    const since = new Date(openedAt).toLocaleTimeString(moneyLocale(locale === 'es' ? 'es' : 'en'), {
        timeZone: settings.timezone,
        hour: '2-digit',
        minute: '2-digit'
    })

    return (
        <Link
            href="/cash"
            title={t('cashTimerTitle', { since })}
            aria-label={t('cashTimerLabel', { register: registerName, elapsed, since })}
            className={cn(
                'ml-auto inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                overdue
                    ? 'border-amber-500/60 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'bg-background'
            )}
        >
            <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="max-w-[10rem] truncate font-medium">{registerName}</span>
            <Timer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <time className="font-mono tabular-nums" dateTime={openedAt} aria-hidden="true">
                {elapsed}
            </time>
        </Link>
    )
}
