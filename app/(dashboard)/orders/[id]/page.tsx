"use client"

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Receipt, RotateCcw, Printer } from 'lucide-react'
import { format } from 'date-fns'
import type { Order, OrderItem } from '@/types'

export default function OrderDetailPage() {
    const params = useParams()
    const router = useRouter()
    const [order, setOrder] = useState<Order | null>(null)
    const [orderItems, setOrderItems] = useState<OrderItem[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (params.id) {
            fetchOrderDetails(params.id as string)
        }
    }, [params.id])

    const fetchOrderDetails = async (id: string) => {
        try {
            const { data: orderData } = await supabase
                .from('orders')
                .select('*, customer:customers(*), created_by_user:profiles!orders_created_by_fkey(*)')
                .eq('id', id)
                .single()

            const { data: itemsData } = await supabase
                .from('order_items')
                .select('*, product:products(*), variant:product_variants(*)')
                .eq('order_id', id)

            setOrder(orderData as any)
            setOrderItems(itemsData as any || [])
        } catch (error: any) {
            toast.error('Failed to load order details')
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    const handleRefund = async () => {
        if (!order) return

        if (!confirm('Are you sure you want to refund this order?')) return

        try {
            const { error } = await supabase
                .from('orders')
                .update({ status: 'refunded' })
                .eq('id', order.id)

            if (error) throw error

            // Restore inventory
            for (const item of orderItems) {
                const { data: inventory } = await supabase
                    .from('inventory')
                    .select('*')
                    .eq('product_id', item.product_id)
                    .eq('variant_id', item.variant_id || null)
                    .single()

                if (inventory) {
                    await supabase
                        .from('inventory')
                        .update({ quantity: inventory.quantity + item.quantity })
                        .eq('id', inventory.id)
                }
            }

            toast.success('Order refunded successfully')
            fetchOrderDetails(order.id)
        } catch (error: any) {
            toast.error(error.message || 'Failed to refund order')
        }
    }

    const handlePrint = () => {
        window.print()
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
            </div>
        )
    }

    if (!order) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">Order not found</p>
                <Button onClick={() => router.push('/orders')} className="mt-4">
                    Back to Orders
                </Button>
            </div>
        )
    }

    return (
        <div className="space-y-6 print:space-y-4">
            <div className="flex items-center justify-between print:hidden">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/orders')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">Order Details</h1>
                        <p className="text-muted-foreground">Order #{order.order_number}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handlePrint}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print
                    </Button>
                    {order.status === 'completed' && (
                        <Button variant="destructive" onClick={handleRefund}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Refund
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle>Order Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Order Number:</span>
                            <span className="font-semibold">{order.order_number}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Date:</span>
                            <span>{format(new Date(order.created_at), 'PPp')}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Status:</span>
                            <Badge variant={order.status === 'completed' ? 'default' : order.status === 'refunded' ? 'destructive' : 'secondary'}>
                                {order.status}
                            </Badge>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Created By:</span>
                            <span>{order.created_by_user?.full_name || 'Unknown'}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle>Customer Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Name:</span>
                            <span className="font-semibold">{order.customer?.name || 'Walk-in Customer'}</span>
                        </div>
                        {order.customer?.email && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Email:</span>
                                <span>{order.customer.email}</span>
                            </div>
                        )}
                        {order.customer?.phone && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Phone:</span>
                                <span>{order.customer.phone}</span>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Order Items */}
            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Receipt className="h-5 w-5 text-emerald-600" />
                        Order Items
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product</TableHead>
                                <TableHead>Variant</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-right">Discount</TableHead>
                                <TableHead className="text-right">Tax</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {orderItems.map((item) => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.product?.name || 'Unknown'}</TableCell>
                                    <TableCell>{item.variant?.name || '-'}</TableCell>
                                    <TableCell className="text-right">{item.quantity}</TableCell>
                                    <TableCell className="text-right">${item.unit_price.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">${item.discount.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">${item.tax.toFixed(2)}</TableCell>
                                    <TableCell className="text-right font-semibold">${item.total.toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>

                    <Separator className="my-4" />

                    {/* Order Summary */}
                    <div className="space-y-2 max-w-sm ml-auto">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Subtotal:</span>
                            <span>${order.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Discount:</span>
                            <span className="text-red-600">-${order.discount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Tax:</span>
                            <span>${order.tax.toFixed(2)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between text-lg font-bold">
                            <span>Total:</span>
                            <span className="text-emerald-600">${order.total.toFixed(2)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
