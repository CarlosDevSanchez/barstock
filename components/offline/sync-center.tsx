'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { PackageOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useMoney } from '@/components/session-provider'
import { discardOutboxEntry, listOutboxEntries, retryOutboxEntry, type OutboxEntry } from '@/lib/offline/outbox'

/** Needs the cashier's attention one way or another; `synced`/`synced_with_issues` are done and drop off the list. */
const ATTENTION_STATES = new Set<OutboxEntry['state']>(['pending', 'syncing', 'paused_auth', 'rejected'])

const STATE_VARIANT: Record<OutboxEntry['state'], 'secondary' | 'outline' | 'destructive'> = {
    pending: 'secondary',
    syncing: 'secondary',
    paused_auth: 'outline',
    rejected: 'destructive',
    synced: 'secondary',
    synced_with_issues: 'secondary'
}

interface DiscardDialogProps {
    entry: OutboxEntry
    onClose: () => void
    onDiscarded: () => void
}

function DiscardDialog({ entry, onClose, onDiscarded }: DiscardDialogProps) {
    const t = useTranslations('sync')
    const tc = useTranslations('common')
    const [reason, setReason] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const canSubmit = reason.trim().length >= 3

    const handleDiscard = async () => {
        setSubmitting(true)
        await discardOutboxEntry(entry.client_ref)
        onDiscarded()
    }

    return (
        <Dialog open onOpenChange={next => !submitting && !next && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('discardTitle', { provisionalNumber: entry.provisional_number })}</DialogTitle>
                    <DialogDescription>{t('discardDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                    <Label htmlFor="discard-reason">{t('discardReasonLabel')}</Label>
                    <Input
                        id="discard-reason"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={t('discardReasonPlaceholder')}
                        autoFocus
                    />
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
                        {tc('cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={!canSubmit || submitting}
                        onClick={handleDiscard}
                    >
                        {submitting ? t('discarding') : t('discard')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

interface SyncCenterProps {
    /** Bumps whenever the background sync (F3) runs — a cheap signal to re-read the queue. */
    pendingCount: number
    onSyncNow: () => void
}

/**
 * Header button + Sheet listing the offline sale queue (F4): a provisional ticket per entry, its state, and
 * "retry"/"discard" for the ones that need a human. `synced`/`synced_with_issues` entries are done and are not
 * shown here — see the order itself (and, for issues, the manager review filter in /orders).
 */
export function SyncCenter({ pendingCount, onSyncNow }: SyncCenterProps) {
    const t = useTranslations('sync')
    const money = useMoney()
    const [open, setOpen] = useState(false)
    const [entries, setEntries] = useState<OutboxEntry[]>([])
    const [discarding, setDiscarding] = useState<OutboxEntry | null>(null)

    const refresh = () => {
        listOutboxEntries().then(setEntries, () => {})
    }

    // Re-read whenever the background sync ticks (F3) or the sheet opens: pendingCount is a proxy for "a run just
    // finished", cheaper than polling the queue on our own timer too.
    useEffect(() => {
        refresh()
    }, [pendingCount, open])

    const attention = entries
        .filter(entry => ATTENTION_STATES.has(entry.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))

    if (attention.length === 0) return null

    return (
        <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
                <PackageOpen className="h-3.5 w-3.5" />
                {t('button', { count: attention.length })}
            </Button>

            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent side="right" className="w-full sm:max-w-md p-0">
                    <SheetHeader style={{ paddingTop: 'env(safe-area-inset-top)' }}>
                        <SheetTitle>{t('title')}</SheetTitle>
                    </SheetHeader>
                    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                onSyncNow()
                                refresh()
                            }}
                        >
                            {t('syncNow')}
                        </Button>
                        {attention.map(entry => (
                            <div key={entry.client_ref} className="rounded-lg border p-3 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-sm font-medium">{entry.provisional_number}</span>
                                    <Badge variant={STATE_VARIANT[entry.state]}>{t(`state.${entry.state}`)}</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">{money(entry.expected_total)}</p>
                                {entry.last_error && <p className="text-xs text-destructive">{entry.last_error}</p>}
                                <div className="flex gap-2 pt-1">
                                    {(entry.state === 'rejected' || entry.state === 'paused_auth') && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={async () => {
                                                await retryOutboxEntry(entry.client_ref)
                                                onSyncNow()
                                                refresh()
                                            }}
                                        >
                                            {t('retry')}
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => setDiscarding(entry)}
                                    >
                                        {t('discard')}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </SheetContent>
            </Sheet>

            {discarding && (
                <DiscardDialog
                    entry={discarding}
                    onClose={() => setDiscarding(null)}
                    onDiscarded={() => {
                        setDiscarding(null)
                        refresh()
                    }}
                />
            )}
        </>
    )
}
