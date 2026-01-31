"use client"

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, ShoppingBag, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import type { Customer, Order } from '@/types'

export default function CustomerDetailPage() {
    const params = useParams()
    const router = useRouter()
    const [customer, setCustomer] = useState<Customer | null>(null)
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (params.id) {
            fetchCustomerDetails(params.id as string)
        }
    }, [params.id])

    const fetchCustomerDetails = async (id: string) => {
        try {
            const { data: customerData } = await supabase
                .from('customers')
                .select('*')
                .eq('id', id)
                .single()

            const { data: ordersData } = await supabase
                .from('orders')
                .select('*')
                .eq('customer_id', id)
                .order('created_at', { ascending: false })

            setCustomer(customerData)
            setOrders(ordersData || [])
        } catch (error: any) {
            toast.error('Failed to load customer details')
            console.error(error)
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

    if (!customer) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">Customer not found</p>
                <Button onClick={() => router.push('/customers')} className="mt-4">
                    Back to Customers
                </Button>
            </div>
        )
    }

    const totalOrders = orders.length
    const completedOrders = orders.filter(o => o.status === 'completed').length

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.push('/customers')}>
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
                        <div className="text-2xl font-bold text-emerald-600">${customer.total_spent.toFixed(2)}</div>
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
                                {orders.map((order) => (
                                    <TableRow
                                        key={order.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => router.push(`/orders/${order.id}`)}
                                    >
                                        <TableCell className="font-mono">{order.order_number}</TableCell>
                                        <TableCell>{format(new Date(order.created_at), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell>
                                            <Badge variant={order.status === 'completed' ? 'default' : order.status === 'refunded' ? 'destructive' : 'secondary'}>
                                                {order.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-semibold text-emerald-600">
                                            ${order.total.toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={(e) => {
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
