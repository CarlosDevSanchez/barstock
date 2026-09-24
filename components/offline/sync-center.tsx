'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { PackageOpen } from 'lucide-react'
import { toast } from 'sonner'
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
import { useMoney, useSession } from '@/components/session-provider'
import { roleAtLeast } from '@/lib/auth/roles'
import { ApiError } from '@/lib/api/client'
import { outboxApi } from '@/lib/api/outbox'
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
    const [error, setError] = useState(false)
    const canSubmit = reason.trim().length >= 3

    const handleDiscard = async () => {
        setSubmitting(true)
        setError(false)
        // Logged before the local delete: discarding forgoes money already collected offline, and the sale never
        // reached the server (there is no order to attach the record to) - this audit entry is the only trace it
        // leaves. Requires a network round trip on purpose: a discard nobody can look back on later is not safe to
        // allow silently offline. The RPC itself refuses (409) if an order already exists for this client_ref —
        // the sale actually reached the server, so discarding it would falsely claim it never did.
        try {
            await outboxApi.logDiscard({
                client_ref: entry.client_ref,
                owner_user_id: entry.user_id,
                provisional_number: entry.provisional_number,
                expected_total: entry.expected_total,
                payment_method: entry.payload.payment_method,
                reason: reason.trim()
            })
        } catch (caught) {
            setSubmitting(false)
            if (caught instanceof ApiError && caught.status === 409) {
                toast.error(t('discardAlreadySynced'))
                onDiscarded() // not a local failure: refresh the list, this entry is about to leave it anyway
                return
            }
            setError(true)
            return
        }
        // Re-checked fresh under the outbox lock (lib/offline/lock.ts): the entry may have started, or finished,
        // syncing in the moment between the click that opened this dialog and this call.
        const result = await discardOutboxEntry(entry.client_ref)
        if (result === 'in_progress') toast.error(t('discardInProgress'))
        else if (result === 'already_synced') toast.error(t('discardAlreadySynced'))
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
                    {error && <p className="text-xs text-destructive">{t('discardLogFailed')}</p>}
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
 * "retry" for the ones that need it. `synced`/`synced_with_issues` entries are done and are not shown here — see
 * the order itself (and, for issues, the manager review filter in /orders). A cashier only sees their own queue; a
 * manager sees everyone's on the device and is the only one who can "discard" one (an audit-logged, RPC-gated
 * decision that forgoes money already collected offline — see log_outbox_discard).
 */
export function SyncCenter({ pendingCount, onSyncNow }: SyncCenterProps) {
    const t = useTranslations('sync')
    const money = useMoney()
    const { user } = useSession()
    const canManage = roleAtLeast(user.role, 'manager')
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
        // On a shared device, a cashier only sees their own queue - not another cashier's who logged out with
        // sales still pending. A manager sees everyone's, since they are the one who can act on it (§Discard).
        .filter(entry => ATTENTION_STATES.has(entry.state) && (canManage || entry.user_id === user.id))
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
                                    {canManage && entry.state !== 'syncing' && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setDiscarding(entry)}
                                        >
                                            {t('discard')}
                                        </Button>
                                    )}
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
