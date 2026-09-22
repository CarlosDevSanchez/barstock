'use client'

import { format } from 'date-fns'
import { DollarSign, Users, TrendingUp, AlertTriangle, Package } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney } from '@/components/session-provider'
import { dashboardApi } from '@/lib/api/reports'
import { calendarDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useApiQuery } from '@/hooks/use-api-query'

export default function DashboardPage() {
    const money = useMoney()
    // One request: the database aggregates (refunded orders excluded, days bucketed in the store time zone).
    const summary = useApiQuery(signal => dashboardApi.get(signal), 'dashboard')

    if (summary.error) return <QueryError error={summary.error} onRetry={summary.reload} />
    if (!summary.data) return <PageSpinner />

    const stats = summary.data
    const salesData = stats.sales_last_7_days.map(day => ({
        date: format(calendarDate(day.date), 'MMM d'),
        revenue: day.revenue
    }))

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Dashboard</h1>
                <p className="text-muted-foreground">Welcome back! Here&apos;s what&apos;s happening today.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="rounded-2xl shadow-sm border-emerald-100 dark:border-emerald-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Today&apos;s Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(stats.today_revenue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            <TrendingUp className="inline h-3 w-3 text-emerald-600" /> From {stats.today_orders} orders
                        </p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Monthly Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{money(stats.month_revenue)}</div>
                        <p className="text-xs text-muted-foreground mt-1">This month</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Customers</CardTitle>
                        <Users className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.total_customers}</div>
                        <p className="text-xs text-muted-foreground mt-1">Total customers</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm border-red-100 dark:border-red-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{stats.low_stock_count}</div>
                        <p className="text-xs text-muted-foreground mt-1">Items need restocking</p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card className="rounded-2xl shadow-sm">
                    <CardHeader>
                        <CardTitle>Sales Overview</CardTitle>
                        <CardDescription>Revenue for the last 7 days</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={salesData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                <XAxis dataKey="date" className="text-xs" />
                                <YAxis className="text-xs" />
                                <Tooltip formatter={value => money(Number(value))} />
                                <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm">
                    <CardHeader>
                        <CardTitle>Top Products</CardTitle>
                        <CardDescription>Best selling items, last 30 days</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
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
            <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        Low Stock Alerts
                    </CardTitle>
                    <CardDescription>Items that need restocking soon</CardDescription>
                </CardHeader>
                <CardContent>
                    {stats.low_stock_items.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">All items are well stocked! 🎉</p>
                    ) : (
                        <div className="space-y-3">
                            {stats.low_stock_items.map(item => (
                                <div
                                    key={item.inventory_id}
                                    className="flex items-center justify-between p-3 rounded-xl bg-muted"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-background">
                                            <Package className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{item.product_name}</p>
                                            <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p
                                            className={cn(
                                                'font-bold',
                                                item.quantity < 5 ? 'text-red-600' : 'text-orange-600'
                                            )}
                                        >
                                            {item.quantity} left
                                        </p>
                                        <p className="text-xs text-muted-foreground">Min: {item.low_stock_threshold}</p>
                                    </div>
                                </div>
                            ))}
                            {stats.low_stock_count > stats.low_stock_items.length && (
                                <p className="text-center text-sm text-muted-foreground">
                                    and {stats.low_stock_count - stats.low_stock_items.length} more
                                </p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
