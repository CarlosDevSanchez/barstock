'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
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
import { SearchableSelect } from '@/components/searchable-select'
import { PaymentFields } from '@/components/pos/payment-dialog'
import { useMoney } from '@/components/session-provider'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useApiQuery } from '@/hooks/use-api-query'
import { errorMessage } from '@/lib/api/client'
import { customersApi } from '@/lib/api/customers'
import { tabsApi, type TabDetail } from '@/lib/api/tabs'
import type { PaymentMethod } from '@/types'

type DebtorMode = 'customer' | 'name'
type RemainderMode = 'all' | 'partial'

export function DeferTabDialog({
    tab,
    onClose,
    onDeferred
}: {
    tab: Pick<TabDetail, 'id' | 'label' | 'customer' | 'totals'>
    onClose: () => void
    onDeferred: (orderId: string) => void
}) {
    const t = useTranslations('tabs')
    const tc = useTranslations('common')
    const money = useMoney()
    const today = new Intl.DateTimeFormat('en-CA').format(new Date())

    const [debtorMode, setDebtorMode] = useState<DebtorMode>(tab.customer ? 'customer' : 'name')
    const [customerId, setCustomerId] = useState(tab.customer?.id ?? '')
    const [debtorName, setDebtorName] = useState(tab.label)
    const [customerSearch, setCustomerSearch] = useState('')
    const debouncedSearch = useDebouncedValue(customerSearch)
    const [dueDate, setDueDate] = useState('')
    const [reminder, setReminder] = useState(false)
    const [note, setNote] = useState('')
    const [remainderMode, setRemainderMode] = useState<RemainderMode>('all')
    const [abono, setAbono] = useState<Array<{ method: PaymentMethod; amount: number }> | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [idempotencyKey] = useState(() => crypto.randomUUID())

    const customers = useApiQuery(
        signal => customersApi.list({ pageSize: 50, q: debouncedSearch }, signal),
        `defer-customers#${debouncedSearch}`
    )
    const customerOptions = [
        ...(tab.customer ? [{ value: tab.customer.id, label: tab.customer.name }] : []),
        ...(customers.data?.data ?? [])
            .filter(row => row.is_active && row.id !== tab.customer?.id)
            .map(row => ({ value: row.id, label: row.name }))
    ]

    const nameOk = debtorName.trim().length >= 2 && debtorName.trim().length <= 120
    const debtorOk = debtorMode === 'customer' ? Boolean(customerId) : nameOk
    const abonoSum = remainderMode === 'partial' ? (abono?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0) : 0
    const remaining = Math.round((tab.totals.balance - abonoSum) * 100) / 100
    const canSubmit = !submitting && Boolean(dueDate) && debtorOk && (remainderMode === 'all' || abono !== null)

    const submit = async () => {
        if (!canSubmit) return
        setSubmitting(true)
        try {
            const order = await tabsApi.defer(
                tab.id,
                {
                    due_date: dueDate,
                    reminder_enabled: reminder,
                    reminder_note: note || null,
                    customer_id: debtorMode === 'customer' ? customerId : null,
                    debtor_name: debtorMode === 'name' ? debtorName.trim() : null,
                    payments: remainderMode === 'partial' && abono ? abono : undefined
                },
                idempotencyKey
            )
            toast.success(t('deferSuccess'))
            onDeferred(order.id)
        } catch (error) {
            toast.error(errorMessage(error, t('deferFailed')))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open onOpenChange={next => !submitting && !next && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('deferTitle')}</DialogTitle>
                    <DialogDescription>{t('deferDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>{t('debtor')}</Label>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant={debtorMode === 'customer' ? 'default' : 'outline'}
                                aria-pressed={debtorMode === 'customer'}
                                onClick={() => setDebtorMode('customer')}
                            >
                                {t('debtorCustomer')}
                            </Button>
                            <Button
                                type="button"
                                variant={debtorMode === 'name' ? 'default' : 'outline'}
                                aria-pressed={debtorMode === 'name'}
                                onClick={() => setDebtorMode('name')}
                            >
                                {t('debtorNameOnly')}
                            </Button>
                        </div>
                        {debtorMode === 'customer' ? (
                            <SearchableSelect
                                id="defer-customer"
                                value={customerId}
                                onValueChange={setCustomerId}
                                search={customerSearch}
                                onSearchChange={setCustomerSearch}
                                placeholder={t('debtorCustomer')}
                                options={customerOptions}
                            />
                        ) : (
                            <Input
                                id="defer-debtor-name"
                                aria-label={t('debtorName')}
                                value={debtorName}
                                onChange={event => setDebtorName(event.target.value)}
                            />
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="space-y-1">
                            <Label htmlFor="defer-due">{t('dueDate')}</Label>
                            <Input
                                id="defer-due"
                                type="date"
                                min={today}
                                value={dueDate}
                                onChange={event => setDueDate(event.target.value)}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <Label htmlFor="defer-reminder">{t('reminder')}</Label>
                            <Button
                                id="defer-reminder"
                                type="button"
                                size="sm"
                                variant={reminder ? 'default' : 'outline'}
                                aria-pressed={reminder}
                                onClick={() => setReminder(current => !current)}
                            >
                                {reminder ? t('reminderYes') : t('reminderNo')}
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>{t('remainder')}</Label>
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                type="button"
                                variant={remainderMode === 'all' ? 'default' : 'outline'}
                                aria-pressed={remainderMode === 'all'}
                                onClick={() => {
                                    setRemainderMode('all')
                                    setAbono(null)
                                }}
                            >
                                {t('payAllBalance')}
                            </Button>
                            <Button
                                type="button"
                                variant={remainderMode === 'partial' ? 'default' : 'outline'}
                                aria-pressed={remainderMode === 'partial'}
                                onClick={() => setRemainderMode('partial')}
                            >
                                {t('payPartialNow')}
                            </Button>
                        </div>
                        {remainderMode === 'partial' && (
                            <PaymentFields
                                amountDue={tab.totals.balance}
                                amountEditable
                                exclusiveMax
                                onPaymentsChange={setAbono}
                            />
                        )}
                    </div>

                    <dl className="space-y-1 text-sm">
                        <div className="flex justify-between gap-3">
                            <dt>{t('total')}</dt>
                            <dd>{money(tab.totals.total)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt>{t('paid')}</dt>
                            <dd>{money(tab.totals.paid)}</dd>
                        </div>
                        {remainderMode === 'partial' && abono && abono.length > 0 && (
                            <div className="space-y-0.5">
                                <div className="flex justify-between gap-3">
                                    <dt>{t('payingNow')}</dt>
                                    <dd>{money(abonoSum)}</dd>
                                </div>
                                {abono.length > 1 &&
                                    abono.map(payment => (
                                        <div
                                            key={payment.method}
                                            className="text-muted-foreground flex justify-between gap-3 pl-3 text-xs"
                                        >
                                            <dt>{tc(`payment.${payment.method}`)}</dt>
                                            <dd>{money(payment.amount)}</dd>
                                        </div>
                                    ))}
                            </div>
                        )}
                        <div className="flex justify-between gap-3 font-semibold">
                            <dt>{t('remaining')}</dt>
                            <dd>{money(remaining)}</dd>
                        </div>
                    </dl>

                    <div className="space-y-1">
                        <Label htmlFor="defer-note">{t('note')}</Label>
                        <Input id="defer-note" value={note} onChange={event => setNote(event.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={submitting} onClick={onClose}>
                        {tc('cancel')}
                    </Button>
                    <Button disabled={!canSubmit} onClick={() => void submit()}>
                        {t('deferConfirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
