'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { cashApi, type BusinessDay, type DeskSession } from '@/lib/api/cash'
import { errorMessage } from '@/lib/api/client'
import { roleAtLeast } from '@/lib/auth/roles'
import { useMoney, useSession } from '@/components/session-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { MultiSelectDropdown } from '@/components/multi-select-dropdown'
import { ListCardRow, ResponsiveList } from '@/components/responsive-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApiQuery } from '@/hooks/use-api-query'
import { usePagination } from '@/hooks/use-pagination'

const toLocalInput = (iso: string) => {
    const date = new Date(iso)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function CashPage() {
    const t = useTranslations('cash')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const money = useMoney()
    const { user } = useSession()
    const desk = useApiQuery(signal => cashApi.current(signal), 'cash-desk')
    const [opening, setOpening] = useState(false)
    const [closeDay, setCloseDay] = useState(false)
    const [floatAmount, setFloatAmount] = useState('')
    const [registerId, setRegisterId] = useState('')
    const [responsibles, setResponsibles] = useState<string[]>([])
    const [movementFor, setMovementFor] = useState<DeskSession | null>(null)
    const [countFor, setCountFor] = useState<DeskSession | null>(null)

    if (desk.error) return <QueryError error={desk.error} onRetry={desk.reload} />
    if (!desk.data) return <PageSpinner />

    const data = desk.data
    const floatValue = floatAmount === '' ? data.default_opening_float : Number(floatAmount)
    const taken = new Set(data.sessions.map(session => session.register_id))
    const freeRegisters = data.registers.filter(register => register.is_active && !taken.has(register.id))
    const chosenRegister = registerId || freeRegisters[0]?.id || ''
    const chosenUsers = responsibles.length ? responsibles : [user.id]
    const when = (iso: string) => format(new Date(iso), 'PPp', { locale: dateLocale })

    const run = async (action: () => Promise<unknown>) => {
        try {
            await action()
            desk.reload()
        } catch (error) {
            toast.error(errorMessage(error))
            throw error
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t('title')}
                description={t('subtitle')}
                actions={
                    data.day ? (
                        <Button variant="outline" onClick={() => setCloseDay(true)}>
                            {t('closeDay')}
                        </Button>
                    ) : (
                        <Button
                            disabled={opening}
                            onClick={() => {
                                setOpening(true)
                                run(() => cashApi.openDay())
                                    .catch(() => undefined)
                                    .finally(() => setOpening(false))
                            }}
                        >
                            {t('openDay')}
                        </Button>
                    )
                }
            />

            {data.day ? (
                <p className="text-sm text-muted-foreground">
                    {t('openedAt', { when: when(data.day.opened_at) })}
                    {data.day.needs_review ? ` · ${t('needsReview')}` : ''}
                </p>
            ) : (
                <p className="text-sm text-muted-foreground">{t('noDay')}</p>
            )}

            {data.day ? (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle>{t('openTill')}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="cash-register">{t('register')}</Label>
                            <Select value={chosenRegister} onValueChange={setRegisterId}>
                                <SelectTrigger id="cash-register" className="w-48">
                                    <SelectValue placeholder={t('register')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {freeRegisters.map(register => (
                                        <SelectItem key={register.id} value={register.id}>
                                            {register.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="cash-float">{t('float')}</Label>
                            <Input
                                id="cash-float"
                                inputMode="decimal"
                                value={floatAmount}
                                placeholder={String(data.default_opening_float)}
                                onChange={event => setFloatAmount(event.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="cash-responsibles">{t('responsibles')}</Label>
                            <MultiSelectDropdown
                                id="cash-responsibles"
                                className="w-56"
                                values={chosenUsers}
                                onChange={setResponsibles}
                                placeholder={t('responsibles')}
                                options={data.staff.map(person => ({
                                    value: person.id,
                                    label: person.full_name ?? person.id.slice(0, 8)
                                }))}
                            />
                        </div>
                        <Button
                            disabled={!chosenRegister || chosenUsers.length === 0}
                            onClick={() =>
                                run(() =>
                                    cashApi.openSession({
                                        register_id: chosenRegister,
                                        opening_float: floatValue,
                                        user_ids: chosenUsers
                                    })
                                ).then(() => {
                                    setFloatAmount('')
                                    setRegisterId('')
                                    setResponsibles([])
                                })
                            }
                        >
                            {t('openTill')}
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {data.sessions.map(session => (
                <Card key={session.id} className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between gap-2">
                        <CardTitle>{session.register_name}</CardTitle>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setMovementFor(session)}>
                                {t('movement')}
                            </Button>
                            <Button size="sm" onClick={() => setCountFor(session)}>
                                {t('count')}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <p>
                            {t('responsibles')}:{' '}
                            {session.users.map(person => person.full_name ?? person.id.slice(0, 8)).join(', ')}
                        </p>
                        <p>
                            {t('float')}: {money(session.opening_float)}
                        </p>
                        {session.expected_cash !== null ? (
                            <p>
                                {t('expected')}: {money(session.expected_cash)}
                            </p>
                        ) : null}
                        <ul className="text-muted-foreground">
                            {session.movements.map(movement => (
                                <li key={movement.id}>
                                    {t(movement.kind === 'deposit' ? 'deposit' : 'withdrawal')} {money(movement.amount)}{' '}
                                    — {movement.reason}
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            ))}

            {roleAtLeast(user.role, 'manager') ? (
                <DayHistory admin={roleAtLeast(user.role, 'admin')} when={when} onChanged={desk.reload} />
            ) : null}

            <ConfirmDialog
                open={closeDay}
                onOpenChange={setCloseDay}
                title={t('closeDay')}
                description={t('closeDayHint')}
                confirmLabel={t('closeDay')}
                onConfirm={async () => {
                    if (!data.day) return
                    await run(() => cashApi.closeDay(data.day!.id))
                }}
            />
            <MovementDialog
                session={movementFor}
                onOpenChange={open => {
                    if (!open) setMovementFor(null)
                }}
                onDone={() => desk.reload()}
            />
            <CountDialog
                session={countFor}
                onOpenChange={open => {
                    if (!open) setCountFor(null)
                }}
                onDone={() => {
                    setCountFor(null)
                    desk.reload()
                }}
            />
        </div>
    )
}

function DayHistory({
    admin,
    when,
    onChanged
}: {
    admin: boolean
    when: (iso: string) => string
    onChanged: () => void
}) {
    const t = useTranslations('cash')
    const tc = useTranslations('common')
    const days = useApiQuery(signal => cashApi.listDays(undefined, signal), 'cash-history')
    const [adjust, setAdjust] = useState<BusinessDay | null>(null)
    const { page, pageSize, setPage, setPageSize } = usePagination()
    if (days.error) return <QueryError error={days.error} onRetry={days.reload} />
    if (!days.data) return null
    // `listDays` returns the full history (no server-side paging), so the table pages through it client-side.
    const pageDays = days.data.slice((page - 1) * pageSize, page * pageSize)
    return (
        <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t('history')}</h2>
            {days.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('historyEmpty')}</p>
            ) : (
                <ResponsiveList
                    items={pageDays}
                    keyOf={day => day.id}
                    table={
                        <Card className="rounded-2xl p-6">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('opened')}</TableHead>
                                        <TableHead>{t('closed')}</TableHead>
                                        <TableHead>{tc('status')}</TableHead>
                                        {admin ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pageDays.map(day => (
                                        <TableRow key={day.id}>
                                            <TableCell>{when(day.opened_at)}</TableCell>
                                            <TableCell>{day.closed_at ? when(day.closed_at) : '—'}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {day.close_kind === 'auto' ? (
                                                        <Badge variant="outline">{t('auto')}</Badge>
                                                    ) : null}
                                                    {day.needs_review ? (
                                                        <Badge variant="outline">{t('needsReview')}</Badge>
                                                    ) : null}
                                                </div>
                                            </TableCell>
                                            {admin ? (
                                                <TableCell className="text-right">
                                                    {day.needs_review ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => setAdjust(day)}
                                                        >
                                                            {t('adjust')}
                                                        </Button>
                                                    ) : null}
                                                </TableCell>
                                            ) : null}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Card>
                    }
                    renderCard={day => (
                        <ListCardRow
                            title={when(day.opened_at)}
                            subtitle={`${day.closed_at ? when(day.closed_at) : '—'}${
                                day.close_kind === 'auto' ? ` · ${t('auto')}` : ''
                            }`}
                            value={day.needs_review ? <Badge variant="outline">{t('needsReview')}</Badge> : undefined}
                            menu={
                                admin && day.needs_review ? (
                                    <button
                                        type="button"
                                        className="hover:bg-accent block w-full rounded-sm px-2 py-1.5 text-left text-sm"
                                        onClick={() => setAdjust(day)}
                                    >
                                        {t('adjust')}
                                    </button>
                                ) : undefined
                            }
                        />
                    )}
                />
            )}
            {days.data.length > 0 ? (
                <Pagination
                    page={page}
                    pageSize={pageSize}
                    total={days.data.length}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                />
            ) : null}
            <AdjustDialog
                day={adjust}
                onOpenChange={open => {
                    if (!open) setAdjust(null)
                }}
                onDone={() => {
                    setAdjust(null)
                    days.reload()
                    onChanged()
                }}
            />
        </section>
    )
}

function MovementDialog({
    session,
    onOpenChange,
    onDone
}: {
    session: DeskSession | null
    onOpenChange: (open: boolean) => void
    onDone: () => void
}) {
    const t = useTranslations('cash')
    const tc = useTranslations('common')
    const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit')
    const [amount, setAmount] = useState('')
    const [reason, setReason] = useState('')
    const [pending, setPending] = useState(false)
    return (
        <Dialog open={session !== null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('movement')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <Select value={kind} onValueChange={value => setKind(value as 'deposit' | 'withdrawal')}>
                        <SelectTrigger aria-label={t('movement')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="deposit">{t('deposit')}</SelectItem>
                            <SelectItem value="withdrawal">{t('withdrawal')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <Input
                        inputMode="decimal"
                        value={amount}
                        aria-label={t('amount')}
                        onChange={e => setAmount(e.target.value)}
                    />
                    <Input value={reason} aria-label={t('reason')} onChange={e => setReason(e.target.value)} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {tc('cancel')}
                    </Button>
                    <Button
                        disabled={pending || !reason.trim() || !(Number(amount) > 0)}
                        onClick={async () => {
                            if (!session) return
                            setPending(true)
                            try {
                                await cashApi.addMovement(session.id, { kind, amount: Number(amount), reason })
                                setAmount('')
                                setReason('')
                                onOpenChange(false)
                                onDone()
                            } catch (error) {
                                toast.error(errorMessage(error))
                            } finally {
                                setPending(false)
                            }
                        }}
                    >
                        {tc('save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function CountDialog({
    session,
    onOpenChange,
    onDone
}: {
    session: DeskSession | null
    onOpenChange: (open: boolean) => void
    onDone: () => void
}) {
    const t = useTranslations('cash')
    const tc = useTranslations('common')
    const money = useMoney()
    const { user } = useSession()
    const canSeeExpected = roleAtLeast(user.role, 'manager')
    const [counted, setCounted] = useState('')
    const [pending, setPending] = useState(false)
    const difference =
        counted === '' || !session || session.expected_cash === null ? null : Number(counted) - session.expected_cash
    return (
        <Dialog
            open={session !== null}
            onOpenChange={open => {
                if (!open) setCounted('')
                onOpenChange(open)
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('count')}</DialogTitle>
                </DialogHeader>
                {session ? (
                    <div className="space-y-3 text-sm">
                        {session.expected_cash !== null ? (
                            <p>
                                {t('expected')}: {money(session.expected_cash)}
                            </p>
                        ) : null}
                        <Input
                            inputMode="decimal"
                            value={counted}
                            aria-label={t('counted')}
                            onChange={event => setCounted(event.target.value)}
                        />
                        {difference !== null && !Number.isNaN(difference) ? (
                            <p>
                                {t('difference')}: {money(difference)}
                            </p>
                        ) : null}
                    </div>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {tc('cancel')}
                    </Button>
                    <Button
                        disabled={pending || counted === '' || Number.isNaN(Number(counted))}
                        onClick={async () => {
                            if (!session) return
                            setPending(true)
                            try {
                                const result = await cashApi.closeSession(session.id, {
                                    counted_cash: Number(counted)
                                })
                                // F4: tolerate a deploy where the code shipped before this migration (result
                                // still `void`/`null` from the old close_cash_session) instead of throwing.
                                if (!canSeeExpected && typeof result?.difference === 'number') {
                                    // R-1: the cashier only learns the difference now, after closing.
                                    toast.info(`${t('difference')}: ${money(result.difference)}`)
                                }
                                setCounted('')
                                onDone()
                            } catch (error) {
                                toast.error(errorMessage(error))
                            } finally {
                                setPending(false)
                            }
                        }}
                    >
                        {t('count')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function AdjustDialog({
    day,
    onOpenChange,
    onDone
}: {
    day: BusinessDay | null
    onOpenChange: (open: boolean) => void
    onDone: () => void
}) {
    const t = useTranslations('cash')
    const tc = useTranslations('common')
    const [opened, setOpened] = useState('')
    const [closed, setClosed] = useState('')
    const [notes, setNotes] = useState('')
    const [pending, setPending] = useState(false)
    const openedValue = opened || (day ? toLocalInput(day.opened_at) : '')
    const closedValue = closed || (day?.closed_at ? toLocalInput(day.closed_at) : '')
    return (
        <Dialog open={day !== null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('adjust')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <Label htmlFor="adjust-open">{t('opened')}</Label>
                    <Input
                        id="adjust-open"
                        type="datetime-local"
                        value={openedValue}
                        onChange={e => setOpened(e.target.value)}
                    />
                    <Label htmlFor="adjust-close">{t('closed')}</Label>
                    <Input
                        id="adjust-close"
                        type="datetime-local"
                        value={closedValue}
                        onChange={e => setClosed(e.target.value)}
                    />
                    <Input
                        value={notes}
                        aria-label={t('notes')}
                        placeholder={t('notes')}
                        onChange={e => setNotes(e.target.value)}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {tc('cancel')}
                    </Button>
                    <Button
                        disabled={pending || !day || !openedValue}
                        onClick={async () => {
                            if (!day) return
                            setPending(true)
                            try {
                                await cashApi.adjustDay(day.id, {
                                    opened_at: openedValue,
                                    closed_at: closedValue || null,
                                    notes: notes || null
                                })
                                onDone()
                            } catch (error) {
                                toast.error(errorMessage(error))
                            } finally {
                                setPending(false)
                            }
                        }}
                    >
                        {tc('save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
