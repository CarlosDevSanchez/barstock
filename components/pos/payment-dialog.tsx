'use client'

import { useState } from 'react'
import { CreditCard, DollarSign, Smartphone } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MoneyInput } from '@/components/money-input'
import { useMoney, useSession } from '@/components/session-provider'
import { currencyDecimals } from '@/lib/money'
import { moneyLocale } from '@/lib/i18n/config'
import { cashDifference, paymentGap, splitRemainder } from '@/lib/tab-split'
import { cn } from '@/lib/utils'
import type { PaymentMethod } from '@/types'

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'ewallet']
const PAYMENT_ICONS: Array<{ value: PaymentMethod; icon: typeof DollarSign }> = [
    { value: 'cash', icon: DollarSign },
    { value: 'card', icon: CreditCard },
    { value: 'ewallet', icon: Smartphone }
]

export interface PaymentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    /** Total to charge (or, when `amountEditable`, the maximum the person can choose to pay). */
    amountDue: number
    /** True lets the person pay less than `amountDue` (a tab/receivable abono); false/omitted charges it in full. */
    amountEditable?: boolean
    submitLabel: string
    processing: boolean
    /** Disables the submit button for a reason outside this dialog's own validation (e.g. the offline window has
     * expired). Shown as inline text, never a tooltip — this dialog runs inside a modal on a tablet POS. */
    disabled?: boolean
    disabledReason?: string
    onSubmit: (payments: Array<{ method: PaymentMethod; amount: number }>) => void
}

/**
 * Reusable payment modal: method selection (single or split two ways), cash received with a live change/short
 * preview, and — when `amountEditable` — a capped, editable amount due for a partial payment. No tooltips: this
 * POS runs on tablets, where hover-only tooltips don't work (see docs/01-arquitectura/06-ui-y-diseno.md).
 */
export function PaymentDialog({
    open,
    onOpenChange,
    title,
    amountDue,
    amountEditable = false,
    submitLabel,
    processing,
    disabled = false,
    disabledReason,
    onSubmit
}: PaymentDialogProps) {
    const t = useTranslations('pos')
    const money = useMoney()

    return (
        <Dialog open={open} onOpenChange={next => !processing && onOpenChange(next)}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {t('estimatedTotal')}{' '}
                        <span className="text-lg font-bold text-emerald-600">{money(amountDue)}</span>
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this subtree while the dialog is closed (no `forceMount`), so every field below
                 * starts from its initial state again the next time it opens — that's the "full reset on open"
                 * the brief asks for, with no effect needed. */}
                <PaymentDialogBody
                    amountDue={amountDue}
                    amountEditable={amountEditable}
                    submitLabel={submitLabel}
                    processing={processing}
                    disabled={disabled}
                    disabledReason={disabledReason}
                    onCancel={() => onOpenChange(false)}
                    onSubmit={onSubmit}
                />
            </DialogContent>
        </Dialog>
    )
}

interface PaymentDialogBodyProps {
    amountDue: number
    amountEditable: boolean
    submitLabel: string
    processing: boolean
    disabled: boolean
    disabledReason?: string
    onCancel: () => void
    onSubmit: (payments: Array<{ method: PaymentMethod; amount: number }>) => void
}

function PaymentDialogBody({
    amountDue,
    amountEditable,
    submitLabel,
    processing,
    disabled,
    disabledReason,
    onCancel,
    onSubmit
}: PaymentDialogBodyProps) {
    const t = useTranslations('pos')
    const tc = useTranslations('common')
    const money = useMoney()
    const { settings, user } = useSession()
    const decimals = currencyDecimals(settings.currency)
    const locale = moneyLocale(user.locale)

    const [method1, setMethod1] = useState<PaymentMethod>('cash')
    const [split, setSplit] = useState(false)
    const [method2, setMethod2] = useState<PaymentMethod>('card')
    const [amount1, setAmount1] = useState<number | null>(null)
    // `touched` false means "still auto-filling from splitRemainder"; it flips true once the person types
    // anything, including clearing the field back to empty — same pattern as `amount2Draft` elsewhere in this
    // codebase (cart-sheet.tsx before this refactor, receivables' PayDialog), adapted for MoneyInput's numeric
    // `null`-means-empty value (which can't double as the "untouched" sentinel the string version used).
    const [amount2Draft, setAmount2Draft] = useState<number | null>(null)
    const [amount2Touched, setAmount2Touched] = useState(false)
    const [received, setReceived] = useState<number | null>(null)
    const [editableAmount, setEditableAmount] = useState<number | null>(amountEditable ? amountDue : null)

    // Cash received and the split amounts only make sense for the current method/split choice: clear them
    // whenever either changes, right where the change happens — same intent as the old `resetSplit()`.
    const clearPaymentEntry = () => {
        setReceived(null)
        setAmount1(null)
        setAmount2Draft(null)
        setAmount2Touched(false)
    }

    const selectMethod1 = (value: PaymentMethod) => {
        setMethod1(value)
        // B7: the two methods can't match — bump the second one out of the way if this change would collide.
        setMethod2(current =>
            split && current === value ? (PAYMENT_METHODS.find(c => c !== value) ?? 'card') : current
        )
        clearPaymentEntry()
    }

    const toggleSplit = () => {
        setSplit(current => {
            const next = !current
            if (next) setMethod2(method1 === 'cash' ? 'card' : 'cash')
            return next
        })
        clearPaymentEntry()
    }

    const amountToPay = amountEditable ? (editableAmount ?? 0) : amountDue
    const editableValid =
        !amountEditable || (editableAmount !== null && editableAmount > 0 && editableAmount <= amountDue)

    const firstAmount = amount1 ?? 0
    const autoSecondAmount = split ? splitRemainder(amountToPay, firstAmount, decimals) : 0
    const secondAmount = amount2Touched ? (amount2Draft ?? 0) : autoSecondAmount
    const gap = split ? paymentGap(amountToPay, [firstAmount, secondAmount], decimals) : 0
    const splitBalanced = gap === 0 && firstAmount > 0 && secondAmount > 0

    const cashDue = split
        ? (method1 === 'cash' ? firstAmount : 0) + (method2 === 'cash' ? secondAmount : 0)
        : method1 === 'cash'
          ? amountToPay
          : 0
    const { change, short } = cashDifference(received ?? 0, cashDue, decimals)

    const canSubmit = !disabled && !processing && editableValid && (split ? splitBalanced : amountToPay > 0)

    const handleSubmit = () => {
        if (!canSubmit) return
        onSubmit(
            split
                ? [
                      { method: method1, amount: firstAmount },
                      { method: method2, amount: secondAmount }
                  ]
                : [{ method: method1, amount: amountToPay }]
        )
    }

    return (
        <>
            <div className="space-y-4 py-4">
                {amountEditable && (
                    <div className="space-y-1">
                        <Label htmlFor="payment-amount-due">{t('paymentAmount')}</Label>
                        <div className="flex items-center gap-2">
                            <MoneyInput
                                id="payment-amount-due"
                                aria-label={t('paymentAmount')}
                                value={editableAmount}
                                onChange={setEditableAmount}
                                decimals={decimals}
                                locale={locale}
                                className="flex-1"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditableAmount(amountDue)}
                            >
                                {t('fullBalance')}
                            </Button>
                        </div>
                        {!editableValid && <p className="text-sm text-red-600">{t('invalidAmount')}</p>}
                    </div>
                )}

                <div className="flex items-center gap-1.5">
                    <Button
                        type="button"
                        variant={split ? 'default' : 'outline'}
                        aria-pressed={split}
                        onClick={toggleSplit}
                    >
                        {t('splitPayment')}
                    </Button>
                </div>
                {split ? (
                    <div className="space-y-3">
                        {[
                            {
                                label: t('firstPayment'),
                                method: method1,
                                onMethod: selectMethod1,
                                options: PAYMENT_METHODS,
                                amount: amount1,
                                onAmount: (value: number | null) => setAmount1(value)
                            },
                            {
                                label: t('secondPayment'),
                                method: method2,
                                onMethod: (value: PaymentMethod) => setMethod2(value),
                                options: PAYMENT_METHODS.filter(candidate => candidate !== method1),
                                amount: secondAmount,
                                onAmount: (value: number | null) => {
                                    setAmount2Touched(true)
                                    setAmount2Draft(value)
                                }
                            }
                        ].map(row => (
                            <div key={row.label} className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label>{row.label}</Label>
                                    <Select
                                        value={row.method}
                                        onValueChange={value => row.onMethod(value as PaymentMethod)}
                                    >
                                        <SelectTrigger aria-label={row.label}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {row.options.map(value => (
                                                <SelectItem key={value} value={value}>
                                                    {tc(`payment.${value}`)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>{t('paymentAmount')}</Label>
                                    <MoneyInput
                                        aria-label={`${row.label} ${t('paymentAmount')}`}
                                        value={row.amount}
                                        onChange={row.onAmount}
                                        decimals={decimals}
                                        locale={locale}
                                    />
                                </div>
                            </div>
                        ))}
                        {gap !== 0 && (
                            <p className="text-sm text-red-600">
                                {gap > 0
                                    ? t('paymentShort', { amount: money(gap) })
                                    : t('paymentOver', { amount: money(Math.abs(gap)) })}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <Label className="text-foreground font-semibold">{t('paymentMethod')}</Label>
                        <div className="grid grid-cols-3 gap-2">
                            {PAYMENT_ICONS.map(({ value, icon: Icon }) => (
                                <Button
                                    key={value}
                                    type="button"
                                    variant={method1 === value ? 'default' : 'outline'}
                                    aria-pressed={method1 === value}
                                    className="flex flex-col h-auto py-4"
                                    onClick={() => selectMethod1(value)}
                                >
                                    <Icon className="h-6 w-6 mb-1" />
                                    <span className="text-xs">{tc(`payment.${value}`)}</span>
                                </Button>
                            ))}
                        </div>
                    </div>
                )}
                {cashDue > 0 && (
                    <div className="space-y-1">
                        <Label htmlFor="cash-received">{t('cashReceived')}</Label>
                        <MoneyInput
                            id="cash-received"
                            aria-label={t('cashReceived')}
                            value={received}
                            onChange={setReceived}
                            decimals={decimals}
                            locale={locale}
                        />
                        {received !== null && (
                            <p
                                className={cn(
                                    'text-sm',
                                    change > 0 && 'font-semibold text-emerald-600',
                                    short > 0 && 'text-amber-700 dark:text-amber-400'
                                )}
                            >
                                {change > 0
                                    ? t('cashChangeAmount', { amount: money(change) })
                                    : short > 0
                                      ? t('paymentShort', { amount: money(short) })
                                      : t('noChange')}
                            </p>
                        )}
                    </div>
                )}
            </div>
            <DialogFooter className="flex-col items-stretch gap-1 sm:flex-row sm:items-center">
                <Button variant="outline" disabled={processing} onClick={onCancel}>
                    {tc('cancel')}
                </Button>
                <div className="flex flex-1 flex-col gap-1 sm:items-end">
                    <Button className="w-full sm:w-auto" disabled={!canSubmit} onClick={handleSubmit}>
                        {processing ? t('processing') : submitLabel}
                    </Button>
                    {disabled && disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
                </div>
            </DialogFooter>
        </>
    )
}
