'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { cashApi } from '@/lib/api/cash'
import { useApiQuery } from '@/hooks/use-api-query'

/** Admin-only. Days closed by the 24h rule, or closed with an uncounted till, stay flagged until reviewed. */
export function ReviewBanner() {
    const t = useTranslations('dashboard')
    const days = useApiQuery(signal => cashApi.listDays(true, signal), 'business-days-review')
    const count = days.data?.length ?? 0
    if (!count) return null
    return (
        <Link
            href="/cash"
            className="block rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
            {t('needsReview', { count })}
        </Link>
    )
}
