'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase/client'
import { DollarSign, ShoppingBag, Users, TrendingUp, AlertTriangle, Package } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { DashboardStats, Product, Inventory } from '@/types'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
    const [stats, setStats] = useState<DashboardStats>({
        todayRevenue: 0,
        monthlyRevenue: 0,
        todayOrders: 0,
        totalCustomers: 0,
        lowStockCount: 0
    })
    const [salesData, setSalesData] = useState<any[]>([])
    const [topProducts, setTopProducts] = useState<any[]>([])
    const [lowStockItems, setLowStockItems] = useState<(Inventory & { product: Product })[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchDashboardData()
    }, [])

    const fetchDashboardData = async () => {
        try {
            const today = new Date().toISOString().split('T')[0]
            const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

            // Today's revenue
            const { data: todayOrders } = await supabase
                .from('orders')
                .select('total')
                .gte('created_at', today)
                .eq('status', 'completed')

            const todayRevenue = todayOrders?.reduce((sum, order) => sum + Number(order.total), 0) || 0

            // Monthly revenue
            const { data: monthlyOrders } = await supabase
                .from('orders')
                .select('total')
                .gte('created_at', firstDayOfMonth)
                .eq('status', 'completed')

            const monthlyRevenue = monthlyOrders?.reduce((sum, order) => sum + Number(order.total), 0) || 0

            // Today's order count
            const todayOrdersCount = todayOrders?.length || 0

            // Total customers
            const { count: customerCount } = await supabase
                .from('customers')
                .select('*', { count: 'exact', head: true })

            // Low stock items
            const { data: lowStock } = await supabase
                .from('inventory')
                .select('*, product: products(*)')
                .lt('quantity', 10)
                .limit(5)

            // Sales chart data (last 7 days)
            const salesChartData = []
            for (let i = 6; i >= 0; i--) {
                const date = new Date()
                date.setDate(date.getDate() - i)
                const dateStr = date.toISOString().split('T')[0]

                const { data: dayOrders } = await supabase
                    .from('orders')
                    .select('total')
                    .gte('created_at', dateStr)
                    .lt('created_at', new Date(date.getTime() + 86400000).toISOString().split('T')[0])
                    .eq('status', 'completed')

                const revenue = dayOrders?.reduce((sum, order) => sum + Number(order.total), 0) || 0

                salesChartData.push({
                    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    revenue: revenue
                })
            }

            // Top products
            const { data: orderItems } = await supabase
                .from('order_items')
                .select('product_id, quantity, product: products(name)')
                .limit(100)

            const productSales: Record<string, { name: string; quantity: number }> = {}
            orderItems?.forEach(item => {
                const productId = item.product_id
                if (!productId) return

                if (!productSales[productId]) {
                    productSales[productId] = {
                        name: (item.product as any)?.name || 'Unknown',
                        quantity: 0
                    }
                }
                productSales[productId].quantity += item.quantity
            })

            const topProductsData = Object.values(productSales)
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 5)

            setStats({
                todayRevenue,
                monthlyRevenue,
                todayOrders: todayOrdersCount,
                totalCustomers: customerCount || 0,
                lowStockCount: lowStock?.length || 0
            })

            setSalesData(salesChartData)
            setTopProducts(topProductsData)
            setLowStockItems((lowStock as any) || [])
        } catch (error) {
            console.error('Error fetching dashboard data:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Dashboard</h1>
                <p className="text-muted-foreground">Welcome back! Here's what's happening today.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="rounded-2xl shadow-sm border-emerald-100 dark:border-emerald-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Today's Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">${stats.todayRevenue.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            <TrendingUp className="inline h-3 w-3 text-emerald-600" /> From {stats.todayOrders} orders
                        </p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Monthly Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">${stats.monthlyRevenue.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground mt-1">This month</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Customers</CardTitle>
                        <Users className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalCustomers}</div>
                        <p className="text-xs text-muted-foreground mt-1">Total customers</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm border-red-100 dark:border-red-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{stats.lowStockCount}</div>
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
                                <Tooltip />
                                <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl shadow-sm">
                    <CardHeader>
                        <CardTitle>Top Products</CardTitle>
                        <CardDescription>Best selling items</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={topProducts}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                <XAxis dataKey="name" className="text-xs" />
                                <YAxis className="text-xs" />
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
                    {lowStockItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">All items are well stocked! 🎉</p>
                    ) : (
                        <div className="space-y-3">
                            {lowStockItems.map(item => (
                                <div
                                    key={item.id}
                                    className="flex items-center justify-between p-3 rounded-xl bg-muted"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-background">
                                            <Package className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{item.product?.name}</p>
                                            <p className="text-sm text-muted-foreground">SKU: {item.product?.sku}</p>
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
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
