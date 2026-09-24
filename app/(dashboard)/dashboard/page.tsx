'use client'

import { format } from 'date-fns'
import { useTranslations } from 'next-intl'
import { DollarSign, Users, TrendingUp, AlertTriangle, Package } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { roleAtLeast } from '@/lib/auth/roles'
import { ReviewBanner } from '@/components/cash/review-banner'
import { DEFAULT_LOCALE } from '@/lib/money'
import { dashboardApi } from '@/lib/api/reports'
import { calendarDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useApiQuery } from '@/hooks/use-api-query'

export default function DashboardPage() {
    const t = useTranslations('dashboard')
    const money = useMoney()
    const { settings, user } = useSession()
    // One request: the database aggregates (refunded orders excluded, days bucketed in the store time zone).
    const summary = useApiQuery(signal => dashboardApi.get(signal), 'dashboard')

    if (summary.error) return <QueryError error={summary.error} onRetry={summary.reload} />
    if (!summary.data) return <PageSpinner />

    const stats = summary.data
    const salesData = stats.sales_last_7_days.map(day => ({
        date: format(calendarDate(day.date), 'MMM d'),
        revenue: day.revenue
    }))
    const compactMoney = (value: number) =>
        new Intl.NumberFormat(DEFAULT_LOCALE, {
            style: 'currency',
            currency: settings.currency,
            notation: 'compact',
            maximumFractionDigits: 1
        }).format(value)

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>
            {roleAtLeast(user.role, 'admin') ? <ReviewBanner /> : null}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <Card className="rounded-2xl border-emerald-100 dark:border-emerald-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('todayRevenue')}</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(stats.today_revenue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            <TrendingUp className="inline h-3 w-3 text-emerald-600" />{' '}
                            {t('fromOrders', { count: stats.today_orders })}
                        </p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('monthlyRevenue')}</CardTitle>
                        <DollarSign className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(stats.month_revenue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('thisMonth')}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('customers')}</CardTitle>
                        <Users className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.total_customers}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('totalCustomers')}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl border-red-100 dark:border-red-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('lowStock')}</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{stats.low_stock_count}</div>
                        <p className="text-xs text-muted-foreground mt-1">{t('itemsNeedRestocking')}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-2">
                <Card className="min-w-0 rounded-2xl">
                    <CardHeader>
                        <CardTitle>{t('salesOverview')}</CardTitle>
                        <CardDescription>{t('revenueLast7Days')}</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[220px] lg:h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={salesData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                <XAxis dataKey="date" className="text-xs" />
                                <YAxis className="text-xs" tickFormatter={compactMoney} width={64} />
                                <Tooltip formatter={value => money(Number(value))} />
                                <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="min-w-0 rounded-2xl">
                    <CardHeader>
                        <CardTitle>{t('topProducts')}</CardTitle>
                        <CardDescription>{t('bestSelling')}</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[220px] lg:h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.top_products}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                <XAxis dataKey="name" className="text-xs" />
                                <YAxis className="text-xs" allowDecimals={false} />
                                <Tooltip />
                                <Bar dataKey="quantity" fill="#10B981" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Low Stock Alerts */}
            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        {t('lowStockAlerts')}
                    </CardTitle>
                    <CardDescription>{t('itemsNeedRestockingSoon')}</CardDescription>
                </CardHeader>
                <CardContent>
                    {stats.low_stock_items.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">{t('allWellStocked')}</p>
                    ) : (
                        <div className="space-y-3">
                            {stats.low_stock_items.map(item => (
                                <div
                                    key={item.inventory_id}
                                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="p-2 rounded-lg bg-background shrink-0">
                                            <Package className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{item.product_name}</p>
                                            <p className="truncate text-sm text-muted-foreground">
                                                {t('sku', { sku: item.sku })}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p
                                            className={cn(
                                                'font-bold',
                                                item.quantity < 5 ? 'text-red-600' : 'text-orange-600'
                                            )}
                                        >
                                            {t('left', { count: item.quantity })}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {t('min', { count: item.low_stock_threshold })}
                                        </p>
                                    </div>
                                </div>
                            ))}
                            {stats.low_stock_count > stats.low_stock_items.length && (
                                <p className="text-center text-sm text-muted-foreground">
                                    {t('andMore', { count: stats.low_stock_count - stats.low_stock_items.length })}
                                </p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
