'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import { BarChart3, TrendingUp, Package, Users, DollarSign } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { reportsApi } from '@/lib/api/reports'
import { calendarDate, dateInZone } from '@/lib/dates'
import { useApiQuery } from '@/hooks/use-api-query'

export default function ReportsPage() {
    const t = useTranslations('reports')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const money = useMoney()
    const { settings } = useSession()
    const [range, setRange] = useState(() => ({
        from: dateInZone(settings.timezone, -6),
        to: dateInZone(settings.timezone)
    }))
    const validRange = range.from !== '' && range.to !== '' && range.from <= range.to

    // Aggregated by the database: refunded orders are excluded, days are bucketed in the store time zone.
    const report = useApiQuery(
        signal => reportsApi.get(range, signal),
        validRange ? JSON.stringify(range) : 'invalid-range'
    )

    const paymentLabel = (method: string) => {
        if (method === 'cash' || method === 'card' || method === 'ewallet') {
            return tc(`payment.${method}`)
        }
        return method
    }

    const dateInputs = (
        <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
                <Label htmlFor="report-from">{t('from')}</Label>
                <Input
                    id="report-from"
                    type="date"
                    value={range.from}
                    max={range.to || undefined}
                    onChange={e => setRange(current => ({ ...current, from: e.target.value }))}
                />
            </div>
            <div className="space-y-1">
                <Label htmlFor="report-to">{t('to')}</Label>
                <Input
                    id="report-to"
                    type="date"
                    value={range.to}
                    min={range.from || undefined}
                    onChange={e => setRange(current => ({ ...current, to: e.target.value }))}
                />
            </div>
        </div>
    )

    const header = (
        <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
                <h1 className="text-3xl font-bold">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>
            {dateInputs}
        </div>
    )

    if (!validRange) {
        return (
            <div className="space-y-6">
                {header}
                <p className="text-sm text-muted-foreground">{t('invalidRange')}</p>
            </div>
        )
    }
    if (report.error) {
        return (
            <div className="space-y-6">
                {header}
                <QueryError error={report.error} onRetry={report.reload} />
            </div>
        )
    }
    if (!report.data) {
        return (
            <div className="space-y-6">
                {header}
                <PageSpinner />
            </div>
        )
    }

    const data = report.data

    return (
        <div className="space-y-6">
            {header}

            <div className="grid gap-4 md:grid-cols-4">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('revenue')}</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{money(data.total_revenue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            {t('taxIncluded', { amount: money(data.total_tax) })}
                        </p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('totalOrders')}</CardTitle>
                        <BarChart3 className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{data.total_orders}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('refundsExcluded')}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('avgOrderValue')}</CardTitle>
                        <TrendingUp className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(data.average_order)}</div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('discountsGiven')}</CardTitle>
                        <Users className="h-4 w-4 text-orange-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(data.total_discount)}</div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-emerald-600" />
                            {t('dailySales')}
                        </CardTitle>
                        <CardDescription>{t('dailySalesDesc', { timezone: data.time_zone })}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {data.daily.map(day => (
                                <div
                                    key={day.date}
                                    className="flex items-center justify-between p-3 rounded-lg bg-muted"
                                >
                                    <div>
                                        <p className="font-medium">
                                            {format(calendarDate(day.date), 'MMM dd', { locale: dateLocale })}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {t('ordersCount', { count: day.orders })}
                                        </p>
                                    </div>
                                    <p className="text-lg font-bold text-emerald-600">{money(day.revenue)}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5 text-purple-600" />
                            {t('topBestSellers')}
                        </CardTitle>
                        <CardDescription>{t('topBestSellersDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {data.top_products.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">{t('noSalesData')}</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('colProduct')}</TableHead>
                                        <TableHead className="text-right">{t('colSold')}</TableHead>
                                        <TableHead className="text-right">{t('colRevenue')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.top_products.map(product => (
                                        <TableRow key={product.product_id}>
                                            <TableCell className="font-medium">{product.name}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="secondary">{product.quantity}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-semibold text-emerald-600">
                                                {money(product.revenue)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-orange-600" />
                            {t('topCustomers')}
                        </CardTitle>
                        <CardDescription>{t('topCustomersDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {data.top_customers.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">{t('noCustomerData')}</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('colCustomer')}</TableHead>
                                        <TableHead className="text-right">{t('colOrders')}</TableHead>
                                        <TableHead className="text-right">{t('colSpent')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.top_customers.map(customer => (
                                        <TableRow key={customer.customer_id}>
                                            <TableCell className="font-medium">{customer.name}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="secondary">{customer.orders}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-semibold text-emerald-600">
                                                {money(customer.spent)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5 text-emerald-600" />
                            {t('paymentMethods')}
                        </CardTitle>
                        <CardDescription>{t('paymentMethodsDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {data.by_payment_method.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">{t('noPayments')}</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('colMethod')}</TableHead>
                                        <TableHead className="text-right">{t('colOrders')}</TableHead>
                                        <TableHead className="text-right">{t('colAmount')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.by_payment_method.map(payment => (
                                        <TableRow key={payment.method}>
                                            <TableCell className="font-medium">
                                                {paymentLabel(payment.method)}
                                            </TableCell>
                                            <TableCell className="text-right">{payment.orders}</TableCell>
                                            <TableCell className="text-right font-semibold text-emerald-600">
                                                {money(payment.amount)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
