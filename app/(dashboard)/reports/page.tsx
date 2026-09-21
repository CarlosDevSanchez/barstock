'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase/client'
import { BarChart3, TrendingUp, Package, Users, DollarSign } from 'lucide-react'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'

type SalesData = {
    date: string
    revenue: number
    orders: number
}

type ProductSales = {
    product_name: string
    total_quantity: number
    total_revenue: number
}

type CustomerData = {
    customer_name: string
    total_spent: number
    order_count: number
}

export default function ReportsPage() {
    const [salesData, setSalesData] = useState<SalesData[]>([])
    const [topProducts, setTopProducts] = useState<ProductSales[]>([])
    const [topCustomers, setTopCustomers] = useState<CustomerData[]>([])
    const [totalRevenue, setTotalRevenue] = useState(0)
    const [totalOrders, setTotalOrders] = useState(0)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchReportsData()
    }, [])

    const fetchReportsData = async () => {
        try {
            // Fetch last 7 days sales
            const last7Days = Array.from({ length: 7 }, (_, i) => {
                const date = subDays(new Date(), 6 - i)
                return {
                    date: format(date, 'yyyy-MM-dd'),
                    start: startOfDay(date).toISOString(),
                    end: endOfDay(date).toISOString()
                }
            })

            const salesPromises = last7Days.map(async ({ date, start, end }) => {
                const { data: orders } = await supabase
                    .from('orders')
                    .select('total')
                    .gte('created_at', start)
                    .lte('created_at', end)
                    .eq('status', 'completed')

                return {
                    date: format(new Date(date), 'MMM dd'),
                    revenue: orders?.reduce((sum, o) => sum + o.total, 0) || 0,
                    orders: orders?.length || 0
                }
            })

            const sales = await Promise.all(salesPromises)
            setSalesData(sales)

            const totalRev = sales.reduce((sum, s) => sum + s.revenue, 0)
            const totalOrd = sales.reduce((sum, s) => sum + s.orders, 0)
            setTotalRevenue(totalRev)
            setTotalOrders(totalOrd)

            // Fetch top selling products
            const { data: orderItems } = await supabase
                .from('order_items')
                .select('product_id, quantity, total, product:products(name)')
                .limit(1000)

            if (orderItems) {
                const productMap = new Map<string, { name: string; quantity: number; revenue: number }>()

                orderItems.forEach((item: any) => {
                    if (item.product && item.product.name) {
                        const name = item.product.name as string
                        const existing = productMap.get(name) || { name, quantity: 0, revenue: 0 }
                        existing.quantity += item.quantity
                        existing.revenue += item.total
                        productMap.set(name, existing)
                    }
                })

                const sorted = Array.from(productMap.values())
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, 5)
                    .map(p => ({
                        product_name: p.name,
                        total_quantity: p.quantity,
                        total_revenue: p.revenue
                    }))

                setTopProducts(sorted)
            }

            // Fetch top customers
            const { data: customers } = await supabase
                .from('customers')
                .select('id, name, total_spent')
                .order('total_spent', { ascending: false })
                .limit(5)

            if (customers) {
                const { data: orders } = await supabase.from('orders').select('customer_id').eq('status', 'completed')

                const customerOrderCount =
                    orders?.reduce(
                        (acc, o) => {
                            if (o.customer_id) {
                                acc[o.customer_id] = (acc[o.customer_id] || 0) + 1
                            }
                            return acc
                        },
                        {} as Record<string, number>
                    ) || {}

                const topCust = customers.map(c => ({
                    customer_name: c.name,
                    total_spent: c.total_spent,
                    order_count: customerOrderCount[c.id] || 0
                }))

                setTopCustomers(topCust)
            }
        } catch (error) {
            console.error('Error fetching reports:', error)
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
                <h1 className="text-3xl font-bold">Reports & Analytics</h1>
                <p className="text-muted-foreground">View detailed business insights and reports</p>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Last 7 Days Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">${totalRevenue.toFixed(2)}</div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                        <BarChart3 className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalOrders}</div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
                        <TrendingUp className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            ${totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0.00'}
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Active Customers</CardTitle>
                        <Users className="h-4 w-4 text-orange-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{topCustomers.length}</div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                {/* Sales Report */}
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-emerald-600" />
                            Daily Sales (Last 7 Days)
                        </CardTitle>
                        <CardDescription>Revenue and order trends</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {salesData.map((day, i) => (
                                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                                    <div>
                                        <p className="font-medium">{day.date}</p>
                                        <p className="text-sm text-muted-foreground">{day.orders} orders</p>
                                    </div>
                                    <p className="text-lg font-bold text-emerald-600">${day.revenue.toFixed(2)}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Best Sellers */}
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5 text-purple-600" />
                            Top 5 Best Sellers
                        </CardTitle>
                        <CardDescription>Highest revenue products</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {topProducts.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">No sales data available</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-right">Sold</TableHead>
                                        <TableHead className="text-right">Revenue</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topProducts.map((product, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-medium">{product.product_name}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="secondary">{product.total_quantity}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-semibold text-emerald-600">
                                                ${product.total_revenue.toFixed(2)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>

                {/* Top Customers */}
                <Card className="rounded-2xl md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-orange-600" />
                            Top 5 Customers
                        </CardTitle>
                        <CardDescription>Highest spending customers</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {topCustomers.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">No customer data available</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Customer</TableHead>
                                        <TableHead className="text-right">Total Spent</TableHead>
                                        <TableHead className="text-right">Loyalty Points</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topCustomers.map((customer, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-medium">{customer.customer_name}</TableCell>
                                            <TableCell className="text-right font-semibold text-emerald-600">
                                                ${customer.total_spent.toFixed(2)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="secondary">{Math.floor(customer.total_spent)}</Badge>
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
