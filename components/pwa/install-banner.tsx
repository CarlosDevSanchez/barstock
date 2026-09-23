'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/hooks/use-pwa-install'

export function InstallBanner() {
    const t = useTranslations('pwa')
    const { visible, mode, install, dismiss } = usePwaInstall()
    const [iosOpen, setIosOpen] = useState(false)

    if (!visible || !mode) return null

    return (
        <div
            role="status"
            className="w-full max-w-md rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/60"
        >
            <div className="flex gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white dark:bg-emerald-700">
                    <Download className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <p className="text-sm font-semibold text-foreground">{t('installTitle')}</p>
                            <p className="text-sm text-muted-foreground">{t('installBody')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={dismiss}
                            className="rounded-md p-1 text-muted-foreground hover:bg-emerald-100 hover:text-foreground dark:hover:bg-emerald-900"
                            aria-label={t('dismiss')}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    {mode === 'prompt' ? (
                        <Button type="button" size="sm" className="w-full sm:w-auto" onClick={() => void install()}>
                            {t('install')}
                        </Button>
                    ) : (
                        <div className="space-y-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="w-full sm:w-auto"
                                onClick={() => setIosOpen(open => !open)}
                                aria-expanded={iosOpen}
                            >
                                {t('installIosHow')}
                            </Button>
                            {iosOpen ? (
                                <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
                                    <li>{t('installIosStep1')}</li>
                                    <li>{t('installIosStep2')}</li>
                                    <li>{t('installIosStep3')}</li>
                                </ol>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
