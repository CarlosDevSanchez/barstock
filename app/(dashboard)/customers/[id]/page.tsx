'use client'

import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, ShoppingBag, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney } from '@/components/session-provider'
import { ApiError } from '@/lib/api/client'
import { customersApi } from '@/lib/api/customers'
import { ordersApi } from '@/lib/api/orders'
import { useApiQuery } from '@/hooks/use-api-query'

export default function CustomerDetailPage() {
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const money = useMoney()

    const customerQuery = useApiQuery(signal => customersApi.get(params.id, signal), `customer:${params.id}`)
    // Cashiers only receive their own orders (RLS); managers and admins receive all of them.
    const ordersQuery = useApiQuery(
        signal => ordersApi.list({ customer_id: params.id, pageSize: 100 }, signal),
        `customer-orders:${params.id}`
    )

    if (customerQuery.error) {
        if (customerQuery.error instanceof ApiError && customerQuery.error.status === 404) {
            return (
                <div className="text-center py-12">
                    <p className="text-muted-foreground">Customer not found</p>
                    <Button onClick={() => router.push('/customers')} className="mt-4">
                        Back to Customers
                    </Button>
                </div>
            )
        }
        return <QueryError error={customerQuery.error} onRetry={customerQuery.reload} />
    }
    if (!customerQuery.data || !ordersQuery.data) {
        return ordersQuery.error ? (
            <QueryError error={ordersQuery.error} onRetry={ordersQuery.reload} />
        ) : (
            <PageSpinner />
        )
    }

    const customer = customerQuery.data
    const orders = ordersQuery.data.data
    const totalOrders = orders.length
    const completedOrders = orders.filter(o => o.status === 'completed').length

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Back to customers"
                    onClick={() => router.push('/customers')}
                >
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">{customer.name}</h1>
                    <p className="text-muted-foreground">Customer Details & Purchase History</p>
                </div>
            </div>

            {/* Customer Info Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{money(customer.total_spent)}</div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                        <ShoppingBag className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{completedOrders}</div>
                        <p className="text-xs text-muted-foreground">of {totalOrders} total</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Loyalty Points</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-purple-600">{customer.loyalty_points}</div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Badge variant={customer.is_active ? 'default' : 'secondary'} className="text-sm">
                            {customer.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                    </CardContent>
                </Card>
            </div>

            {/* Customer Information */}
            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle>Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="font-medium">{customer.email || '-'}</p>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">Phone</p>
                        <p className="font-medium">{customer.phone || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                        <p className="text-sm text-muted-foreground">Address</p>
                        <p className="font-medium">{customer.address || '-'}</p>
                    </div>
                </CardContent>
            </Card>

            {/* Purchase History */}
            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle>Purchase History</CardTitle>
                </CardHeader>
                <CardContent>
                    {orders.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">No purchase history yet</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Order #</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {orders.map(order => (
                                    <TableRow
                                        key={order.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => router.push(`/orders/${order.id}`)}
                                    >
                                        <TableCell className="font-mono">{order.order_number}</TableCell>
                                        <TableCell>{format(new Date(order.created_at), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    order.status === 'completed'
                                                        ? 'default'
                                                        : order.status === 'refunded'
                                                          ? 'destructive'
                                                          : 'secondary'
                                                }
                                            >
                                                {order.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-semibold text-emerald-600">
                                            {money(order.total)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    router.push(`/orders/${order.id}`)
                                                }}
                                            >
                                                View
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
