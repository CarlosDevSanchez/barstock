'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { ListCardRow, ResponsiveList } from '@/components/responsive-list'
import { useMoney, useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { receivablesApi, type ReceivableRow } from '@/lib/api/receivables'
import { roleAtLeast } from '@/lib/auth/roles'
import { currencyDecimals } from '@/lib/money'
import { PAYMENT_METHODS } from '@/lib/validation/resources'
import type { PaymentMethod } from '@/types'
import { useApiQuery } from '@/hooks/use-api-query'

type StatusFilter = '' | 'pending' | 'written_off'

export default function ReceivablesPage() {
    const t = useTranslations('receivables')
    const money = useMoney()
    const { settings, user } = useSession()
    const decimals = currencyDecimals(settings.currency)
    const canEdit = roleAtLeast(user.role, 'manager')
    const canWriteOff = roleAtLeast(user.role, 'admin')

    const [status, setStatus] = useState<StatusFilter>('pending')
    const [paying, setPaying] = useState<ReceivableRow | null>(null)
    const [editing, setEditing] = useState<ReceivableRow | null>(null)
    const [writingOff, setWritingOff] = useState<ReceivableRow | null>(null)
    const [writeOffReason, setWriteOffReason] = useState('')

    const list = useApiQuery(
        signal =>
            receivablesApi.list(
                {
                    ...(status ? { status } : {})
                },
                signal
            ),
        `receivables:${status || 'all'}`
    )

    const rows = list.data ?? []

    return (
        <div className="space-y-6">
            <div className="min-w-0">
                <h1 className="truncate text-xl font-bold lg:text-3xl">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>

            <div className="space-y-1">
                <Label htmlFor="receivable-status">{t('status')}</Label>
                <select
                    id="receivable-status"
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                    value={status}
                    onChange={event => setStatus(event.target.value as StatusFilter)}
                >
                    <option value="">{t('filterAll')}</option>
                    <option value="pending">{t('filterPending')}</option>
                    <option value="written_off">{t('filterWrittenOff')}</option>
                </select>
            </div>

            {list.error ? <QueryError error={list.error} onRetry={list.reload} /> : null}
            {!list.data && !list.error ? <PageSpinner /> : null}
            {list.data && rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}

            {rows.length > 0 ? (
                <ResponsiveList
                    items={rows}
                    keyOf={row => row.order_id}
                    table={
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('customer')}</TableHead>
                                    <TableHead>{t('total')}</TableHead>
                                    <TableHead>{t('paid')}</TableHead>
                                    <TableHead>{t('balance')}</TableHead>
                                    <TableHead>{t('dueDate')}</TableHead>
                                    <TableHead>{t('status')}</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map(row => (
                                    <TableRow key={row.order_id}>
                                        <TableCell>
                                            <div className="font-medium">{row.customer_name ?? '—'}</div>
                                            <div className="text-xs text-muted-foreground">{row.order_number}</div>
                                        </TableCell>
                                        <TableCell>{money(row.total)}</TableCell>
                                        <TableCell>{money(row.paid)}</TableCell>
                                        <TableCell>{money(row.balance)}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span>{row.due_date ?? '—'}</span>
                                                {row.days_overdue > 0 && row.status === 'pending' ? (
                                                    <Badge variant="destructive">{t('overdue')}</Badge>
                                                ) : null}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {row.status === 'written_off' ? t('statusWrittenOff') : t('statusPending')}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <RowActions
                                                row={row}
                                                canEdit={canEdit}
                                                canWriteOff={canWriteOff}
                                                onPay={() => setPaying(row)}
                                                onEdit={() => setEditing(row)}
                                                onWriteOff={() => {
                                                    setWriteOffReason('')
                                                    setWritingOff(row)
                                                }}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    }
                    renderCard={row => (
                        <ListCardRow
                            title={row.customer_name ?? row.order_number}
                            subtitle={`${row.order_number} · ${row.due_date ?? '—'} · ${
                                row.status === 'written_off' ? t('statusWrittenOff') : t('statusPending')
                            }`}
                            value={
                                <span className="flex flex-col items-end gap-1">
                                    <span>{money(row.balance)}</span>
                                    {row.days_overdue > 0 && row.status === 'pending' ? (
                                        <Badge variant="destructive">{t('overdue')}</Badge>
                                    ) : null}
                                </span>
                            }
                            menu={
                                row.status === 'pending' ? (
                                    <>
                                        <button
                                            type="button"
                                            className="hover:bg-accent block w-full rounded-sm px-2 py-1.5 text-left text-sm"
                                            onClick={() => setPaying(row)}
                                        >
                                            {t('recordPayment')}
                                        </button>
                                        {canEdit ? (
                                            <button
                                                type="button"
                                                className="hover:bg-accent block w-full rounded-sm px-2 py-1.5 text-left text-sm"
                                                onClick={() => setEditing(row)}
                                            >
                                                {t('edit')}
                                            </button>
                                        ) : null}
                                        {canWriteOff ? (
                                            <button
                                                type="button"
                                                className="hover:bg-accent text-destructive block w-full rounded-sm px-2 py-1.5 text-left text-sm"
                                                onClick={() => {
                                                    setWriteOffReason('')
                                                    setWritingOff(row)
                                                }}
                                            >
                                                {t('writeOff')}
                                            </button>
                                        ) : null}
                                    </>
                                ) : undefined
                            }
                        />
                    )}
                />
            ) : null}

            {paying ? (
                <PayDialog
                    row={paying}
                    decimals={decimals}
                    onClose={() => setPaying(null)}
                    onDone={() => {
                        setPaying(null)
                        void list.reload()
                    }}
                />
            ) : null}

            {editing ? (
                <EditDialog
                    row={editing}
                    onClose={() => setEditing(null)}
                    onDone={() => {
                        setEditing(null)
                        void list.reload()
                    }}
                />
            ) : null}

            <ConfirmDialog
                open={writingOff !== null}
                onOpenChange={open => {
                    if (!open) setWritingOff(null)
                }}
                title={t('writeOffTitle')}
                description={
                    <div className="space-y-3">
                        <p>{t('writeOffDescription')}</p>
                        <div className="space-y-1">
                            <Label htmlFor="write-off-reason">{t('writeOffReason')}</Label>
                            <Input
                                id="write-off-reason"
                                value={writeOffReason}
                                onChange={event => setWriteOffReason(event.target.value)}
                            />
                        </div>
                    </div>
                }
                confirmLabel={t('writeOffConfirm')}
                onConfirm={async () => {
                    if (!writingOff) return
                    try {
                        await receivablesApi.writeOff(writingOff.order_id, { reason: writeOffReason })
                        toast.success(t('writeOffSuccess'))
                        setWritingOff(null)
                        void list.reload()
                    } catch (error) {
                        toast.error(errorMessage(error, t('writeOffFailed')))
                        throw error
                    }
                }}
            />
        </div>
    )
}

function RowActions({
    row,
    canEdit,
    canWriteOff,
    onPay,
    onEdit,
    onWriteOff
}: {
    row: ReceivableRow
    canEdit: boolean
    canWriteOff: boolean
    onPay: () => void
    onEdit: () => void
    onWriteOff: () => void
}) {
    const t = useTranslations('receivables')
    if (row.status !== 'pending') return null
    return (
        <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onPay}>
                {t('recordPayment')}
            </Button>
            {canEdit ? (
                <Button size="sm" variant="ghost" onClick={onEdit}>
                    {t('edit')}
                </Button>
            ) : null}
            {canWriteOff ? (
                <Button size="sm" variant="destructive" onClick={onWriteOff}>
                    {t('writeOff')}
                </Button>
            ) : null}
        </div>
    )
}

function PayDialog({
    row,
    decimals,
    onClose,
    onDone
}: {
    row: ReceivableRow
    decimals: number
    onClose: () => void
    onDone: () => void
}) {
    const t = useTranslations('receivables')
    const tc = useTranslations('common')
    const [method1, setMethod1] = useState<PaymentMethod>('cash')
    const [method2, setMethod2] = useState<PaymentMethod>('card')
    const [amount1, setAmount1] = useState(String(row.balance))
    const [split, setSplit] = useState(false)
    const [amount2, setAmount2] = useState('')
    const [submitting, setSubmitting] = useState(false)
    // U3/C5: generated once when the dialog opens and reused on every retry, so a double-click or a retry after
    // a dropped response replays the same request instead of paying twice.
    const [idempotencyKey] = useState(() => crypto.randomUUID())

    const submit = async () => {
        setSubmitting(true)
        try {
            const payments = split
                ? [
                      { method: method1, amount: Number(amount1) || 0 },
                      { method: method2, amount: Number(amount2) || 0 }
                  ]
                : [{ method: method1, amount: Number(amount1) || 0 }]
            await receivablesApi.pay(row.order_id, { payments }, idempotencyKey)
            toast.success(t('paymentSuccess'))
            onDone()
        } catch (error) {
            toast.error(errorMessage(error, t('paymentFailed')))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open onOpenChange={next => !submitting && !next && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('recordPayment')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        {row.order_number} · {row.customer_name}
                    </p>
                    <div className="space-y-1">
                        <Label>{t('paymentMethod')}</Label>
                        <select
                            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                            value={method1}
                            onChange={event => setMethod1(event.target.value as PaymentMethod)}
                        >
                            {PAYMENT_METHODS.map(method => (
                                <option key={method} value={method}>
                                    {tc(`payment.${method}`)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label>{t('amount')}</Label>
                        <Input
                            type="number"
                            min="0"
                            step={decimals === 0 ? 1 : 0.01}
                            value={amount1}
                            onChange={event => setAmount1(event.target.value)}
                        />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSplit(current => !current)}>
                        {t('splitPayment')}
                    </Button>
                    {split ? (
                        <>
                            <div className="space-y-1">
                                <Label>{t('secondPayment')}</Label>
                                <select
                                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                                    value={method2}
                                    onChange={event => setMethod2(event.target.value as PaymentMethod)}
                                >
                                    {PAYMENT_METHODS.map(method => (
                                        <option key={method} value={method}>
                                            {tc(`payment.${method}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Label>{t('amount')}</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step={decimals === 0 ? 1 : 0.01}
                                    value={amount2}
                                    onChange={event => setAmount2(event.target.value)}
                                />
                            </div>
                        </>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={submitting} onClick={onClose}>
                        {t('cancel')}
                    </Button>
                    <Button disabled={submitting} onClick={() => void submit()}>
                        {t('recordPayment')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function EditDialog({ row, onClose, onDone }: { row: ReceivableRow; onClose: () => void; onDone: () => void }) {
    const t = useTranslations('receivables')
    const [dueDate, setDueDate] = useState(row.due_date ?? '')
    const [reminder, setReminder] = useState(row.reminder_enabled)
    const [note, setNote] = useState(row.reminder_note ?? '')
    const [submitting, setSubmitting] = useState(false)

    const submit = async () => {
        setSubmitting(true)
        try {
            await receivablesApi.update(row.order_id, {
                due_date: dueDate || null,
                reminder_enabled: reminder,
                reminder_note: note || null
            })
            toast.success(t('editSuccess'))
            onDone()
        } catch (error) {
            toast.error(errorMessage(error, t('editFailed')))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open onOpenChange={next => !submitting && !next && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('editTitle')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="edit-due">{t('dueDate')}</Label>
                        <Input
                            id="edit-due"
                            type="date"
                            value={dueDate}
                            onChange={event => setDueDate(event.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="edit-reminder">{t('reminder')}</Label>
                        <select
                            id="edit-reminder"
                            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                            value={reminder ? 'yes' : 'no'}
                            onChange={event => setReminder(event.target.value === 'yes')}
                        >
                            <option value="yes">{t('reminderYes')}</option>
                            <option value="no">{t('reminderNo')}</option>
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="edit-note">{t('note')}</Label>
                        <Input id="edit-note" value={note} onChange={event => setNote(event.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={submitting} onClick={onClose}>
                        {t('cancel')}
                    </Button>
                    <Button disabled={submitting} onClick={() => void submit()}>
                        {t('save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
