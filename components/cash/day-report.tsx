'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import { cashApi } from '@/lib/api/cash'
import { useMoney } from '@/components/session-provider'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApiQuery } from '@/hooks/use-api-query'

export function DayReport() {
    const t = useTranslations('reports')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const money = useMoney()
    const days = useApiQuery(signal => cashApi.listDays(undefined, signal), 'business-days')
    const [dayId, setDayId] = useState<string | null>(null)
    const selected = dayId ?? days.data?.[0]?.id ?? null
    const report = useApiQuery(
        signal => (selected ? cashApi.report(selected, signal) : Promise.resolve(null)),
        selected ?? 'none'
    )

    if (days.error) return <QueryError error={days.error} onRetry={days.reload} />
    if (!days.data) return <PageSpinner />
    if (days.data.length === 0) return <p className="text-sm text-muted-foreground">{t('noDays')}</p>

    const paymentLabel = (method: string) =>
        method === 'cash' || method === 'card' || method === 'ewallet' ? tc(`payment.${method}`) : method

    return (
        <div className="space-y-6">
            <div className="space-y-1 max-w-sm">
                <Label htmlFor="report-day">{t('selectDay')}</Label>
                <Select value={selected ?? undefined} onValueChange={setDayId}>
                    <SelectTrigger id="report-day" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {days.data.map(day => (
                            <SelectItem key={day.id} value={day.id}>
                                {format(new Date(day.opened_at), 'PPp', { locale: dateLocale })}
                                {day.closed_at ? '' : ` · ${t('open')}`}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {report.error ? <QueryError error={report.error} onRetry={report.reload} /> : null}
            {!report.data ? <PageSpinner /> : null}
            {report.data ? (
                <>
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                        <Card className="rounded-2xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">{t('revenue')}</CardTitle>
                            </CardHeader>
                            <CardContent className="text-2xl font-bold">{money(report.data.total_revenue)}</CardContent>
                        </Card>
                        <Card className="rounded-2xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">{t('totalOrders')}</CardTitle>
                            </CardHeader>
                            <CardContent className="text-2xl font-bold">{report.data.total_orders}</CardContent>
                        </Card>
                        <Card className="rounded-2xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">{t('withoutRegister')}</CardTitle>
                            </CardHeader>
                            <CardContent className="text-2xl font-bold">
                                {report.data.sales_without_register}
                            </CardContent>
                        </Card>
                    </div>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('colMethod')}</TableHead>
                                <TableHead>{t('colOrders')}</TableHead>
                                <TableHead>{t('colAmount')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report.data.payments_by_method.map(row => (
                                <TableRow key={row.payment_method}>
                                    <TableCell>{paymentLabel(row.payment_method)}</TableCell>
                                    <TableCell>{row.order_count}</TableCell>
                                    <TableCell>{money(row.total)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('register')}</TableHead>
                                <TableHead>{t('openingFloat')}</TableHead>
                                <TableHead>{t('expectedCash')}</TableHead>
                                <TableHead>{t('countedCash')}</TableHead>
                                <TableHead>{t('difference')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report.data.sessions.map(session => (
                                <TableRow key={session.session_id}>
                                    <TableCell>{session.register_name}</TableCell>
                                    <TableCell>{money(session.opening_float)}</TableCell>
                                    <TableCell>
                                        {session.expected_cash === null ? '—' : money(session.expected_cash)}
                                    </TableCell>
                                    <TableCell>
                                        {session.counted_cash === null ? '—' : money(session.counted_cash)}
                                    </TableCell>
                                    <TableCell>
                                        {session.difference === null ? '—' : money(session.difference)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </>
            ) : null}
        </div>
    )
}
