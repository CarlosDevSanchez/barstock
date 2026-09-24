'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CreditCard, DollarSign, Smartphone, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { useMoney, useSession } from '@/components/session-provider'
import { OfflineDisabledButton } from '@/components/pwa/offline-disabled-button'
import { errorMessage } from '@/lib/api/client'
import { tabsApi, type TabDetail } from '@/lib/api/tabs'
import { groupOrderItemsByPromotion, type GroupableOrderItem } from '@/lib/order-item-groups'
import { cashChange, paymentGap, splitEqual, splitRemainder, validateCustom } from '@/lib/tab-split'
import { currencyDecimals } from '@/lib/money'
import { roleAtLeast } from '@/lib/auth/roles'
import { useApiQuery } from '@/hooks/use-api-query'
import { PageSpinner } from '@/components/page-spinner'
import { QueryError } from '@/components/query-error'
import type { PaymentMethod } from '@/types'

interface TabDetailSheetProps {
    tabId: string | null
    onClose: () => void
    /** A tab was paid, voided or otherwise changed: refresh whatever list is showing it. */
    onChanged: () => void
    /** The tab just closed into an order. The POS opens the same "sale completed" dialog as a direct sale. */
    onOrderClosed?: (orderId: string) => void
}

const PAYMENT_ICONS: Array<{ value: PaymentMethod; icon: typeof DollarSign }> = [
    { value: 'cash', icon: DollarSign },
    { value: 'card', icon: CreditCard },
    { value: 'ewallet', icon: Smartphone }
]

function RemoveItemDialog({
    tabId,
    item,
    onClose,
    onRemoved
}: {
    tabId: string
    item: TabDetail['items'][number]
    onClose: () => void
    onRemoved: (tab: TabDetail) => void
}) {
    const t = useTranslations('tabs')
    const tc = useTranslations('common')
    const [quantity, setQuantity] = useState(item.quantity)
    const [reason, setReason] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const submit = async () => {
        setSubmitting(true)
        try {
            const tab = await tabsApi.removeItem(tabId, item.id, { quantity, reason })
            toast.success(t('itemRemoved'))
            onRemoved(tab)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('removeItemFailed')))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open onOpenChange={next => !submitting && !next && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('removeItem', { name: item.product.name })}</DialogTitle>
                    <DialogDescription>{t('removeItemDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="remove-qty">{t('quantityToRemove')}</Label>
                        <Input
                            id="remove-qty"
                            type="number"
                            min={1}
                            max={item.quantity}
                            value={quantity}
                            onChange={e =>
                                setQuantity(Math.max(1, Math.min(item.quantity, Number(e.target.value) || 1)))
                            }
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="remove-reason">{tc('reason')}</Label>
                        <Input id="remove-reason" value={reason} onChange={e => setReason(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={submitting} onClick={onClose}>
                        {tc('cancel')}
                    </Button>
                    <Button variant="destructive" disabled={submitting || reason.trim().length < 3} onClick={submit}>
                        {submitting ? t('removing') : t('removeItemAction')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function VoidTabDialog({ onClose, onVoid }: { onClose: () => void; onVoid: (reason: string) => Promise<void> }) {
    const t = useTranslations('tabs')
    const tc = useTranslations('common')
    const [reason, setReason] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const submit = async () => {
        setSubmitting(true)
        try {
            await onVoid(reason)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('voidTabFailed')))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open onOpenChange={next => !submitting && !next && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('voidTab')}</DialogTitle>
                    <DialogDescription>{t('voidTabDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                    <Label htmlFor="void-reason">{tc('reason')}</Label>
                    <Input id="void-reason" value={reason} onChange={e => setReason(e.target.value)} />
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={submitting} onClick={onClose}>
                        {tc('cancel')}
                    </Button>
                    <Button variant="destructive" disabled={submitting || reason.trim().length < 3} onClick={submit}>
                        {submitting ? t('voiding') : t('voidTabAction')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** Full detail of one tab: items, members, totals, payments and the split/pay/void actions. */
export function TabDetailSheet({ tabId, onClose, onChanged, onOrderClosed }: TabDetailSheetProps) {
    const t = useTranslations('tabs')
    const tPos = useTranslations('pos')
    const tc = useTranslations('common')
    const router = useRouter()
    const money = useMoney()
    const { settings, user } = useSession()
    const decimals = currencyDecimals(settings.currency)
    const isManager = roleAtLeast(user.role, 'manager')

    const tabQuery = useApiQuery(
        signal => (tabId ? tabsApi.get(tabId, signal) : Promise.resolve(undefined)),
        tabId ? `tab:${tabId}` : 'tab:none'
    )
    const [removingItem, setRemovingItem] = useState<TabDetail['items'][number] | null>(null)
    const [voiding, setVoiding] = useState(false)
    const [splitMode, setSplitMode] = useState<'equal' | 'custom' | null>(null)
    const [selectedMembers, setSelectedMembers] = useState<string[]>([])
    const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
    const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
    const [payingKey, setPayingKey] = useState<string | null>(null)
    const [splitPay, setSplitPay] = useState(false)
    const [payMethod2, setPayMethod2] = useState<PaymentMethod>('card')
    const [payAmount1, setPayAmount1] = useState('')
    const [payAmount2Draft, setPayAmount2Draft] = useState<string | null>(null)
    const [cashReceived, setCashReceived] = useState('')

    const tab = tabQuery.data
    const balance = tab?.totals.balance ?? 0
    const payAmount2 =
        payAmount2Draft ??
        (splitPay ? splitRemainder(balance, Number(payAmount1) || 0, decimals).toFixed(decimals) : '')
    const itemGroups = useMemo(() => {
        if (!tab) return []
        const groupable: GroupableOrderItem[] = tab.items.map(item => {
            const lineDiscount = item.discount ?? 0
            const base = item.unit_price * item.quantity - lineDiscount
            return {
                id: item.id,
                promotion_id: item.promotion_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                discount: lineDiscount,
                tax: 0,
                total: base,
                tax_rate: item.tax_rate,
                product: item.product,
                variant: item.variant,
                promotion: item.promotion
            }
        })
        return groupOrderItemsByPromotion(groupable)
    }, [tab])

    const applyChange = (next: TabDetail) => {
        tabQuery.reload()
        onChanged()
        if (next.status === 'closed' && next.order_id) {
            if (onOrderClosed) {
                onClose()
                onOrderClosed(next.order_id)
                return
            }
            const orderId = next.order_id
            toast.success(t('closed', { tabNumber: next.tab_number }), {
                action: { label: t('viewOrder'), onClick: () => router.push(`/orders/${orderId}`) }
            })
        }
    }

    const paySplitFull = async () => {
        if (!tabId) return
        setPayingKey('full')
        try {
            const next = await tabsApi.paySplit(tabId, {
                member_id: null,
                payments: [
                    { method: payMethod, amount: Number(payAmount1) || 0 },
                    { method: payMethod2, amount: Number(payAmount2) || 0 }
                ]
            })
            toast.success(t('paymentRecorded'))
            applyChange(next)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('paymentFailed')))
        } finally {
            setPayingKey(null)
        }
    }

    const pay = async (memberId: string | null, amount: number, key: string) => {
        if (!tabId || amount <= 0) return
        setPayingKey(key)
        try {
            const tab = await tabsApi.pay(tabId, { member_id: memberId, payment_method: payMethod, amount })
            toast.success(t('paymentRecorded'))
            applyChange(tab)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('paymentFailed')))
        } finally {
            setPayingKey(null)
        }
    }

    const handleVoid = async (reason: string) => {
        if (!tabId) return
        const tab = await tabsApi.void(tabId, { reason })
        toast.success(t('voided'))
        applyChange(tab)
    }

    return (
        <>
            <Sheet open={!!tabId} onOpenChange={open => !open && onClose()}>
                <SheetContent side="right" className="w-full sm:max-w-lg p-0">
                    {tabQuery.error ? (
                        <div className="p-4">
                            <QueryError error={tabQuery.error} onRetry={tabQuery.reload} />
                        </div>
                    ) : !tabQuery.data ? (
                        <PageSpinner />
                    ) : (
                        (() => {
                            const tab = tabQuery.data
                            const isOpen = tab.status === 'open'
                            const canPay = isOpen && tab.totals.balance > 0
                            const equalShares =
                                splitMode === 'equal' && selectedMembers.length > 0
                                    ? splitEqual(tab.totals.balance, selectedMembers.length, decimals)
                                    : []
                            const customCheck = validateCustom(
                                tab.members.map(member => Number(customAmounts[member.id] ?? 0) || 0),
                                tab.totals.balance,
                                decimals
                            )

                            return (
                                <div className="flex flex-col h-full overflow-y-auto">
                                    <SheetHeader>
                                        <SheetTitle className="flex items-center gap-2 flex-wrap">
                                            {tab.label}
                                            <Badge
                                                variant={
                                                    tab.status === 'open'
                                                        ? 'secondary'
                                                        : tab.status === 'closed'
                                                          ? 'default'
                                                          : 'destructive'
                                                }
                                            >
                                                {t(`status.${tab.status}`)}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground font-normal">
                                                {tab.tab_number}
                                            </span>
                                        </SheetTitle>
                                    </SheetHeader>

                                    <div
                                        className="px-4 space-y-4 flex-1"
                                        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
                                    >
                                        {/* Items */}
                                        <div>
                                            <h3 className="text-sm font-semibold mb-2">{t('items')}</h3>
                                            {tab.items.length === 0 ? (
                                                <p className="text-sm text-muted-foreground">{t('noItems')}</p>
                                            ) : (
                                                <ul className="space-y-2">
                                                    {itemGroups.map(group => {
                                                        if (group.kind === 'product') {
                                                            const item = tab.items.find(i => i.id === group.item.id)
                                                            if (!item) return null
                                                            const lineTotal =
                                                                item.unit_price * item.quantity - (item.discount ?? 0)
                                                            return (
                                                                <li
                                                                    key={item.id}
                                                                    className="flex items-center gap-2 rounded-lg bg-muted p-2"
                                                                >
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-sm font-medium truncate">
                                                                            {item.product.name}
                                                                        </p>
                                                                        <p className="text-xs text-muted-foreground">
                                                                            {item.quantity} × {money(item.unit_price)}
                                                                        </p>
                                                                    </div>
                                                                    <span className="text-sm font-semibold">
                                                                        {money(lineTotal)}
                                                                    </span>
                                                                    {isManager && isOpen && (
                                                                        <Button
                                                                            size="icon"
                                                                            variant="ghost"
                                                                            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                                            aria-label={t('removeItem', {
                                                                                name: item.product.name
                                                                            })}
                                                                            onClick={() => setRemovingItem(item)}
                                                                        >
                                                                            <Trash2 className="h-3 w-3" />
                                                                        </Button>
                                                                    )}
                                                                </li>
                                                            )
                                                        }

                                                        return (
                                                            <li
                                                                key={group.promotionId}
                                                                className="flex items-start gap-2 rounded-lg bg-muted p-2"
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400 truncate">
                                                                        {tPos('promoLine', { name: group.name })}
                                                                    </p>
                                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                                        {t('promoPackages', {
                                                                            count: group.packageQty
                                                                        })}
                                                                    </p>
                                                                    <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                                                                        {group.items
                                                                            .map(
                                                                                line =>
                                                                                    `${line.quantity}× ${line.product.name}`
                                                                            )
                                                                            .join(' · ')}
                                                                    </p>
                                                                </div>
                                                                <span className="text-sm font-semibold shrink-0">
                                                                    {money(group.total)}
                                                                </span>
                                                            </li>
                                                        )
                                                    })}
                                                </ul>
                                            )}
                                        </div>

                                        {/* Members */}
                                        {tab.members.length > 0 && (
                                            <div>
                                                <h3 className="text-sm font-semibold mb-2">{t('people')}</h3>
                                                <div className="flex flex-wrap gap-1">
                                                    {tab.members.map(member => (
                                                        <Badge key={member.id} variant="outline">
                                                            {member.display_name}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <Separator />

                                        {/* Totals */}
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span>{t('subtotal')}</span>
                                                <span>{money(tab.totals.subtotal)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>{t('tax')}</span>
                                                <span>{money(tab.totals.tax)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>{t('discount')}</span>
                                                <span>{money(tab.totals.discount)}</span>
                                            </div>
                                            <div className="flex justify-between font-semibold">
                                                <span>{t('total')}</span>
                                                <span>{money(tab.totals.total)}</span>
                                            </div>
                                            <div className="flex justify-between text-emerald-600">
                                                <span>{t('paid')}</span>
                                                <span>{money(tab.totals.paid)}</span>
                                            </div>
                                            <div className="flex justify-between text-lg font-bold">
                                                <span>{t('balance')}</span>
                                                <span>{money(tab.totals.balance)}</span>
                                            </div>
                                        </div>

                                        {/* Payments so far */}
                                        {tab.payments.length > 0 && (
                                            <div>
                                                <h3 className="text-sm font-semibold mb-2">{t('paymentsMade')}</h3>
                                                <ul className="space-y-1 text-sm">
                                                    {tab.payments.map(payment => {
                                                        const member = tab.members.find(m => m.id === payment.member_id)
                                                        return (
                                                            <li key={payment.id} className="flex justify-between">
                                                                <span className="text-muted-foreground">
                                                                    {member?.display_name ?? t('unassignedPayer')} ·{' '}
                                                                    {tc(`payment.${payment.payment_method}`)}
                                                                </span>
                                                                <span>{money(payment.amount)}</span>
                                                            </li>
                                                        )
                                                    })}
                                                </ul>
                                            </div>
                                        )}

                                        {/* Pay */}
                                        {canPay && (
                                            <div className="space-y-3 rounded-xl border p-3">
                                                <h3 className="text-sm font-semibold">{t('collectPayment')}</h3>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {PAYMENT_ICONS.map(({ value, icon: Icon }) => (
                                                        <Button
                                                            key={value}
                                                            type="button"
                                                            variant={payMethod === value ? 'default' : 'outline'}
                                                            size="sm"
                                                            aria-pressed={payMethod === value}
                                                            onClick={() => setPayMethod(value)}
                                                        >
                                                            <Icon className="h-4 w-4 mr-1" />
                                                            {tc(`payment.${value}`)}
                                                        </Button>
                                                    ))}
                                                </div>

                                                <Button
                                                    type="button"
                                                    variant={splitPay ? 'default' : 'outline'}
                                                    size="sm"
                                                    aria-pressed={splitPay}
                                                    onClick={() => {
                                                        setSplitPay(on => {
                                                            const next = !on
                                                            if (next) {
                                                                setPayAmount2Draft(null)
                                                                setPayMethod2(payMethod === 'cash' ? 'card' : 'cash')
                                                            }
                                                            return next
                                                        })
                                                    }}
                                                >
                                                    {tPos('splitPayment')}
                                                </Button>
                                                {splitPay && (
                                                    <div className="space-y-2">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div className="space-y-1">
                                                                <Label>{tPos('paymentAmount')}</Label>
                                                                <Input
                                                                    type="number"
                                                                    min="0"
                                                                    step={decimals === 0 ? 1 : 0.01}
                                                                    aria-label={tPos('paymentAmount')}
                                                                    value={payAmount1}
                                                                    onChange={event =>
                                                                        setPayAmount1(event.target.value)
                                                                    }
                                                                />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <Label>{tPos('secondPayment')}</Label>
                                                                <Select
                                                                    value={payMethod2}
                                                                    onValueChange={value =>
                                                                        setPayMethod2(value as PaymentMethod)
                                                                    }
                                                                >
                                                                    <SelectTrigger aria-label={tPos('secondPayment')}>
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {PAYMENT_ICONS.map(({ value }) => (
                                                                            <SelectItem key={value} value={value}>
                                                                                {tc(`payment.${value}`)}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step={decimals === 0 ? 1 : 0.01}
                                                            aria-label={`${tPos('secondPayment')} ${tPos('paymentAmount')}`}
                                                            value={payAmount2}
                                                            onChange={event => setPayAmount2Draft(event.target.value)}
                                                        />
                                                        {(() => {
                                                            const gap = paymentGap(
                                                                tab.totals.balance,
                                                                [Number(payAmount1) || 0, Number(payAmount2) || 0],
                                                                decimals
                                                            )
                                                            if (gap === 0) return null
                                                            return (
                                                                <p className="text-sm text-red-600">
                                                                    {gap > 0
                                                                        ? tPos('paymentShort', { amount: money(gap) })
                                                                        : tPos('paymentOver', {
                                                                              amount: money(Math.abs(gap))
                                                                          })}
                                                                </p>
                                                            )
                                                        })()}
                                                        {(payMethod === 'cash' || payMethod2 === 'cash') && (
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="space-y-1">
                                                                    <Label htmlFor="tab-cash-received">
                                                                        {tPos('cashReceived')}
                                                                    </Label>
                                                                    <Input
                                                                        id="tab-cash-received"
                                                                        type="number"
                                                                        min="0"
                                                                        step={decimals === 0 ? 1 : 0.01}
                                                                        value={cashReceived}
                                                                        onChange={event =>
                                                                            setCashReceived(event.target.value)
                                                                        }
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label>{tPos('cashChange')}</Label>
                                                                    <p className="h-9 flex items-center font-medium">
                                                                        {money(
                                                                            cashChange(
                                                                                Number(cashReceived) || 0,
                                                                                (payMethod === 'cash'
                                                                                    ? Number(payAmount1) || 0
                                                                                    : 0) +
                                                                                    (payMethod2 === 'cash'
                                                                                        ? Number(payAmount2) || 0
                                                                                        : 0),
                                                                                decimals
                                                                            )
                                                                        )}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <OfflineDisabledButton
                                                    className="w-full"
                                                    disabled={
                                                        payingKey !== null ||
                                                        (splitPay &&
                                                            paymentGap(
                                                                tab.totals.balance,
                                                                [Number(payAmount1) || 0, Number(payAmount2) || 0],
                                                                decimals
                                                            ) !== 0) ||
                                                        (splitPay &&
                                                            ((Number(payAmount1) || 0) <= 0 ||
                                                                (Number(payAmount2) || 0) <= 0))
                                                    }
                                                    onClick={() =>
                                                        splitPay
                                                            ? void paySplitFull()
                                                            : pay(null, tab.totals.balance, 'full')
                                                    }
                                                >
                                                    {payingKey === 'full'
                                                        ? t('paying')
                                                        : t('payFullBalance', { amount: money(tab.totals.balance) })}
                                                </OfflineDisabledButton>

                                                {tab.members.length > 1 && (
                                                    <div className="flex flex-wrap gap-2 text-xs">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant={splitMode === 'equal' ? 'default' : 'outline'}
                                                            onClick={() =>
                                                                setSplitMode(splitMode === 'equal' ? null : 'equal')
                                                            }
                                                        >
                                                            {t('splitEqually')}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant={splitMode === 'custom' ? 'default' : 'outline'}
                                                            onClick={() =>
                                                                setSplitMode(splitMode === 'custom' ? null : 'custom')
                                                            }
                                                        >
                                                            {t('splitCustom')}
                                                        </Button>
                                                    </div>
                                                )}

                                                {splitMode === 'equal' && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs text-muted-foreground">
                                                            {t('splitEquallyHint')}
                                                        </p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {tab.members.map(member => (
                                                                <button
                                                                    key={member.id}
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setSelectedMembers(current =>
                                                                            current.includes(member.id)
                                                                                ? current.filter(id => id !== member.id)
                                                                                : [...current, member.id]
                                                                        )
                                                                    }
                                                                >
                                                                    <Badge
                                                                        variant={
                                                                            selectedMembers.includes(member.id)
                                                                                ? 'default'
                                                                                : 'outline'
                                                                        }
                                                                    >
                                                                        {member.display_name}
                                                                    </Badge>
                                                                </button>
                                                            ))}
                                                        </div>
                                                        {selectedMembers.map((memberId, index) => {
                                                            const member = tab.members.find(m => m.id === memberId)
                                                            const share = equalShares[index] ?? 0
                                                            return (
                                                                <div
                                                                    key={memberId}
                                                                    className="flex items-center justify-between gap-2 text-sm"
                                                                >
                                                                    <span>{member?.display_name}</span>
                                                                    <span className="font-medium">{money(share)}</span>
                                                                    <Button
                                                                        size="sm"
                                                                        disabled={payingKey !== null}
                                                                        onClick={() =>
                                                                            pay(memberId, share, `equal:${memberId}`)
                                                                        }
                                                                    >
                                                                        {payingKey === `equal:${memberId}`
                                                                            ? t('paying')
                                                                            : t('pay')}
                                                                    </Button>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}

                                                {splitMode === 'custom' && (
                                                    <div className="space-y-2">
                                                        <p className="text-xs text-muted-foreground">
                                                            {customCheck.valid
                                                                ? t('remainingAmount', {
                                                                      amount: money(customCheck.remaining)
                                                                  })
                                                                : t('overBalance')}
                                                        </p>
                                                        {tab.members.map(member => (
                                                            <div
                                                                key={member.id}
                                                                className="flex items-center justify-between gap-2 text-sm"
                                                            >
                                                                <span className="flex-1 truncate">
                                                                    {member.display_name}
                                                                </span>
                                                                <Input
                                                                    type="number"
                                                                    className="w-24 h-8"
                                                                    min={0}
                                                                    value={customAmounts[member.id] ?? ''}
                                                                    onChange={e =>
                                                                        setCustomAmounts(current => ({
                                                                            ...current,
                                                                            [member.id]: e.target.value
                                                                        }))
                                                                    }
                                                                />
                                                                <Button
                                                                    size="sm"
                                                                    disabled={
                                                                        payingKey !== null ||
                                                                        !(Number(customAmounts[member.id]) > 0)
                                                                    }
                                                                    onClick={() =>
                                                                        pay(
                                                                            member.id,
                                                                            Number(customAmounts[member.id]) || 0,
                                                                            `custom:${member.id}`
                                                                        )
                                                                    }
                                                                >
                                                                    {payingKey === `custom:${member.id}`
                                                                        ? t('paying')
                                                                        : t('pay')}
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {isManager && isOpen && tab.payments.length === 0 && (
                                            <Button
                                                variant="destructive"
                                                className="w-full"
                                                onClick={() => setVoiding(true)}
                                            >
                                                {t('voidTab')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )
                        })()
                    )}
                </SheetContent>
            </Sheet>

            {removingItem && tabId && (
                <RemoveItemDialog
                    tabId={tabId}
                    item={removingItem}
                    onClose={() => setRemovingItem(null)}
                    onRemoved={tab => {
                        setRemovingItem(null)
                        applyChange(tab)
                    }}
                />
            )}

            {voiding && (
                <VoidTabDialog
                    onClose={() => setVoiding(false)}
                    onVoid={async reason => {
                        await handleVoid(reason)
                        setVoiding(false)
                    }}
                />
            )}
        </>
    )
}
