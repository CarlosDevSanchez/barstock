'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import {
    BarChart3,
    TrendingUp,
    Package,
    Users,
    DollarSign,
    Percent,
    Wallet,
    SlidersHorizontal,
    Receipt
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { ResponsiveList, ListCardRow } from '@/components/responsive-list'
import { useMoney, useSession } from '@/components/session-provider'
import { reportsApi } from '@/lib/api/reports'
import { DayReport } from '@/components/cash/day-report'
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
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [mode, setMode] = useState<'dates' | 'day'>('dates')
    const validRange = range.from !== '' && range.to !== '' && range.from <= range.to
    const rangeSummary =
        range.from && range.to
            ? `${format(calendarDate(range.from), 'MMM dd', { locale: dateLocale })} – ${format(calendarDate(range.to), 'MMM dd', { locale: dateLocale })}`
            : t('invalidRange')

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
            <div className="min-w-0">
                <h1 className="text-xl font-bold truncate lg:text-3xl">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
                <div className="mt-3 flex gap-2">
                    <Button variant={mode === 'dates' ? 'default' : 'outline'} onClick={() => setMode('dates')}>
                        {t('byDates')}
                    </Button>
                    <Button variant={mode === 'day' ? 'default' : 'outline'} onClick={() => setMode('day')}>
                        {t('byDay')}
                    </Button>
                </div>
            </div>
            {mode === 'dates' ? <div className="hidden lg:block">{dateInputs}</div> : null}
            {mode === 'dates' ? (
                <Button variant="outline" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
                    <SlidersHorizontal className="mr-2 size-4" />
                    {rangeSummary}
                </Button>
            ) : null}
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                <SheetContent side="bottom" className="rounded-t-2xl">
                    <SheetHeader>
                        <SheetTitle>{tc('filters')}</SheetTitle>
                    </SheetHeader>
                    <div className="px-4 pb-6">{dateInputs}</div>
                </SheetContent>
            </Sheet>
        </div>
    )

    if (mode === 'day') {
        return (
            <div className="space-y-6">
                {header}
                <DayReport />
            </div>
        )
    }

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

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('promoMarkdown')}</CardTitle>
                        <Percent className="h-4 w-4 text-amber-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(data.promo_markdown)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('promoMarkdownHint')}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('totalCogs')}</CardTitle>
                        <Wallet className="h-4 w-4 text-slate-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(data.total_cogs)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('totalCogsHint')}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('grossProfit')}</CardTitle>
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{money(data.gross_profit)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('grossProfitHint')}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('totalExpenses')}</CardTitle>
                        <Receipt className="h-4 w-4 text-rose-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(data.total_expenses)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('totalExpensesHint')}</p>
                        {data.expenses_by_category.length > 0 ? (
                            <ul className="mt-3 space-y-1 text-sm">
                                {data.expenses_by_category.map(row => (
                                    <li key={row.category} className="flex justify-between gap-3">
                                        <span className="truncate">{row.category}</span>
                                        <span>{money(row.total)}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('netProfit')}</CardTitle>
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(data.net_profit)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('netProfitHint')}</p>
                        {data.written_off_total > 0 ? (
                            <p className="mt-2 text-sm">
                                {t('writtenOffTotal')}: {money(data.written_off_total)}
                            </p>
                        ) : null}
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Card className="min-w-0 rounded-2xl">
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
                                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium">
                                            {format(calendarDate(day.date), 'MMM dd', { locale: dateLocale })}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {t('ordersCount', { count: day.orders })}
                                        </p>
                                    </div>
                                    <p className="shrink-0 text-lg font-bold text-emerald-600">{money(day.revenue)}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="min-w-0 rounded-2xl">
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
                            <ResponsiveList
                                items={data.top_products}
                                keyOf={product => product.product_id}
                                table={
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>{t('colProduct')}</TableHead>
                                                <TableHead className="text-right">{t('colSold')}</TableHead>
                                                <TableHead className="text-right">{t('colRevenue')}</TableHead>
                                                <TableHead className="text-right">{t('colCogs')}</TableHead>
                                                <TableHead className="text-right">{t('colGrossProfit')}</TableHead>
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
                                                    <TableCell className="text-right text-muted-foreground">
                                                        {money(product.cogs)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold">
                                                        {money(product.gross_profit)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                }
                                renderCard={product => (
                                    <ListCardRow
                                        title={product.name}
                                        subtitle={t('colSold') + `: ${product.quantity}`}
                                        value={
                                            <span className="font-semibold text-emerald-600">
                                                {money(product.revenue)}
                                            </span>
                                        }
                                    />
                                )}
                            />
                        )}
                    </CardContent>
                </Card>

                <Card className="min-w-0 rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Percent className="h-5 w-5 text-amber-600" />
                            {t('topPromotions')}
                        </CardTitle>
                        <CardDescription>{t('topPromotionsDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {data.top_promotions.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">{t('noPromoData')}</p>
                        ) : (
                            <ResponsiveList
                                items={data.top_promotions}
                                keyOf={promo => promo.promotion_id}
                                table={
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>{t('colPromotion')}</TableHead>
                                                <TableHead className="text-right">{t('colOrders')}</TableHead>
                                                <TableHead className="text-right">{t('colPackages')}</TableHead>
                                                <TableHead className="text-right">{t('colRevenue')}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {data.top_promotions.map(promo => (
                                                <TableRow key={promo.promotion_id}>
                                                    <TableCell className="font-medium">{promo.name}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Badge variant="secondary">{promo.orders}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right">{promo.packages}</TableCell>
                                                    <TableCell className="text-right font-semibold text-emerald-600">
                                                        {money(promo.revenue)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                }
                                renderCard={promo => (
                                    <ListCardRow
                                        title={promo.name}
                                        subtitle={t('colPackages') + `: ${promo.packages}`}
                                        value={
                                            <span className="font-semibold text-emerald-600">
                                                {money(promo.revenue)}
                                            </span>
                                        }
                                    />
                                )}
                            />
                        )}
                    </CardContent>
                </Card>

                <Card className="min-w-0 rounded-2xl">
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
                            <ResponsiveList
                                items={data.top_customers}
                                keyOf={customer => customer.customer_id}
                                table={
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
                                }
                                renderCard={customer => (
                                    <ListCardRow
                                        title={customer.name}
                                        subtitle={t('colOrders') + `: ${customer.orders}`}
                                        value={
                                            <span className="font-semibold text-emerald-600">
                                                {money(customer.spent)}
                                            </span>
                                        }
                                    />
                                )}
                            />
                        )}
                    </CardContent>
                </Card>

                <Card className="min-w-0 rounded-2xl xl:col-span-2">
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
                            <ResponsiveList
                                items={data.by_payment_method}
                                keyOf={payment => payment.method}
                                table={
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
                                }
                                renderCard={payment => (
                                    <ListCardRow
                                        title={paymentLabel(payment.method)}
                                        subtitle={t('colOrders') + `: ${payment.orders}`}
                                        value={
                                            <span className="font-semibold text-emerald-600">
                                                {money(payment.amount)}
                                            </span>
                                        }
                                    />
                                )}
                            />
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
