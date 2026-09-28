'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { ListCardRow, ResponsiveList } from '@/components/responsive-list'
import { useMoney, useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { cashApi } from '@/lib/api/cash'
import { expensesApi, type ExpenseRow } from '@/lib/api/expenses'
import { roleAtLeast } from '@/lib/auth/roles'
import { dateInZone } from '@/lib/dates'
import { expenseCreateSchema } from '@/lib/validation/expenses'
import { PAYMENT_METHODS } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'

export default function ExpensesPage() {
    const t = useTranslations('expenses')
    const money = useMoney()
    const { settings, user } = useSession()
    const [range, setRange] = useState(() => ({
        from: dateInZone(settings.timezone, -6),
        to: dateInZone(settings.timezone),
        category_id: ''
    }))
    const [open, setOpen] = useState(false)
    const [voiding, setVoiding] = useState<ExpenseRow | null>(null)
    const [reason, setReason] = useState('')
    const canVoid = roleAtLeast(user.role, 'admin')

    const list = useApiQuery(
        signal =>
            expensesApi.list(
                {
                    from: range.from || undefined,
                    to: range.to || undefined,
                    category_id: range.category_id || undefined
                },
                signal
            ),
        JSON.stringify(range)
    )
    const desk = useApiQuery(signal => cashApi.current(signal), 'cash-desk')

    const rows = list.data?.rows ?? []
    const categories = list.data?.categories ?? []

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="truncate text-xl font-bold lg:text-3xl">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>
                <Button onClick={() => setOpen(true)}>
                    <Plus className="mr-2 size-4" />
                    {t('add')}
                </Button>
            </div>

            <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                    <Label htmlFor="expense-from">{t('from')}</Label>
                    <Input
                        id="expense-from"
                        type="date"
                        value={range.from}
                        onChange={event => setRange(current => ({ ...current, from: event.target.value }))}
                    />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="expense-to">{t('to')}</Label>
                    <Input
                        id="expense-to"
                        type="date"
                        value={range.to}
                        onChange={event => setRange(current => ({ ...current, to: event.target.value }))}
                    />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="expense-category">{t('category')}</Label>
                    <select
                        id="expense-category"
                        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                        value={range.category_id}
                        onChange={event => setRange(current => ({ ...current, category_id: event.target.value }))}
                    >
                        <option value="">{t('allCategories')}</option>
                        {categories.map(category => (
                            <option key={category.id} value={category.id}>
                                {category.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {list.data && list.data.byCategory.length > 0 ? (
                <Card className="rounded-2xl">
                    <CardContent className="space-y-2 pt-6">
                        <p className="text-sm font-medium">{t('byCategory')}</p>
                        <ul className="space-y-1 text-sm">
                            {list.data.byCategory.map(row => (
                                <li key={row.category} className="flex justify-between gap-3">
                                    <span>{row.category}</span>
                                    <span>{money(row.total)}</span>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            ) : null}

            {list.error ? <QueryError error={list.error} onRetry={list.reload} /> : null}
            {!list.data && !list.error ? <PageSpinner /> : null}
            {list.data && rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}
            {rows.length > 0 ? (
                <ResponsiveList
                    items={rows}
                    keyOf={row => row.id}
                    table={
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('colWhen')}</TableHead>
                                    <TableHead>{t('colCategory')}</TableHead>
                                    <TableHead>{t('colDescription')}</TableHead>
                                    <TableHead className="text-right">{t('colAmount')}</TableHead>
                                    {canVoid ? <TableHead /> : null}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map(row => (
                                    <TableRow key={row.id}>
                                        <TableCell>{row.occurred_at.slice(0, 10)}</TableCell>
                                        <TableCell>{row.category}</TableCell>
                                        <TableCell>{row.description}</TableCell>
                                        <TableCell className="text-right">{money(row.amount)}</TableCell>
                                        {canVoid ? (
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={t('void')}
                                                    onClick={() => {
                                                        setReason('')
                                                        setVoiding(row)
                                                    }}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </TableCell>
                                        ) : null}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    }
                    renderCard={row => (
                        <ListCardRow
                            title={row.description}
                            subtitle={`${row.category} · ${row.occurred_at.slice(0, 10)}`}
                            value={money(row.amount)}
                            menu={
                                canVoid ? (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t('void')}
                                        onClick={() => {
                                            setReason('')
                                            setVoiding(row)
                                        }}
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
                                ) : null
                            }
                        />
                    )}
                />
            ) : null}

            <ExpenseDialog
                key={open ? 'open' : 'closed'}
                open={open}
                categories={categories}
                sessions={(desk.data?.sessions ?? []).map(session => ({
                    id: session.id,
                    name: session.register_name
                }))}
                onOpenChange={setOpen}
                onSaved={list.reload}
            />

            <Dialog open={voiding !== null} onOpenChange={next => !next && setVoiding(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('voidTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-1">
                        <Label htmlFor="void-reason">{t('voidReason')}</Label>
                        <Input id="void-reason" value={reason} onChange={event => setReason(event.target.value)} />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="destructive"
                            onClick={async () => {
                                if (!voiding || reason.trim() === '') return
                                try {
                                    await expensesApi.void(voiding.id, reason.trim())
                                    toast.success(t('voided'))
                                    setVoiding(null)
                                    list.reload()
                                } catch (error) {
                                    toast.error(errorMessage(error))
                                }
                            }}
                        >
                            {t('void')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function ExpenseDialog({
    open,
    categories,
    sessions,
    onOpenChange,
    onSaved
}: {
    open: boolean
    categories: { id: string; name: string }[]
    sessions: { id: string; name: string }[]
    onOpenChange: (open: boolean) => void
    onSaved: () => void
}) {
    const t = useTranslations('expenses')
    const tc = useTranslations('common')
    const [categoryId, setCategoryId] = useState('')
    const [description, setDescription] = useState('')
    const [amount, setAmount] = useState('')
    const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash')
    const [when, setWhen] = useState('')
    const [fromTill, setFromTill] = useState(false)
    const [sessionId, setSessionId] = useState('')
    const [pending, setPending] = useState(false)
    const selectedCategory = categoryId || categories[0]?.id || ''
    const selectedSession = sessionId || sessions[0]?.id || ''

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('add')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="new-category">{t('category')}</Label>
                        <select
                            id="new-category"
                            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                            value={selectedCategory}
                            onChange={event => setCategoryId(event.target.value)}
                        >
                            {categories.map(category => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="new-description">{t('description')}</Label>
                        <Input
                            id="new-description"
                            value={description}
                            onChange={event => setDescription(event.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="new-amount">{t('amount')}</Label>
                        <Input
                            id="new-amount"
                            inputMode="decimal"
                            value={amount}
                            onChange={event => setAmount(event.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="new-method">{t('method')}</Label>
                        <select
                            id="new-method"
                            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                            value={fromTill ? 'cash' : method}
                            disabled={fromTill}
                            onChange={event => setMethod(event.target.value as (typeof PAYMENT_METHODS)[number])}
                        >
                            {PAYMENT_METHODS.map(value => (
                                <option key={value} value={value}>
                                    {tc(`payment.${value}`)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="new-when">{t('when')}</Label>
                        <Input id="new-when" type="date" value={when} onChange={event => setWhen(event.target.value)} />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={fromTill}
                            onChange={event => setFromTill(event.target.checked)}
                        />
                        {t('paidFromTill')}
                    </label>
                    {fromTill ? (
                        <div className="space-y-1">
                            <Label htmlFor="new-till">{t('till')}</Label>
                            {sessions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t('noOpenTill')}</p>
                            ) : (
                                <select
                                    id="new-till"
                                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                                    value={selectedSession}
                                    onChange={event => setSessionId(event.target.value)}
                                >
                                    {sessions.map(session => (
                                        <option key={session.id} value={session.id}>
                                            {session.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button
                        disabled={pending}
                        onClick={async () => {
                            const parsed = expenseCreateSchema.safeParse({
                                category_id: selectedCategory,
                                description,
                                amount,
                                payment_method: fromTill ? 'cash' : method,
                                occurred_at: when ? new Date(`${when}T12:00:00`).toISOString() : null,
                                supplier_id: null,
                                cash_session_id: fromTill ? selectedSession || null : null
                            })
                            if (!parsed.success) {
                                toast.error(errorMessage(parsed.error))
                                return
                            }
                            setPending(true)
                            try {
                                await expensesApi.create(parsed.data)
                                toast.success(t('created'))
                                onOpenChange(false)
                                onSaved()
                            } catch (error) {
                                toast.error(errorMessage(error))
                            } finally {
                                setPending(false)
                            }
                        }}
                    >
                        {t('save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
