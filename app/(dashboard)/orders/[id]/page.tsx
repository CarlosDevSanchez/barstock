'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { ArrowLeft, Receipt, RotateCcw, Printer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { TextField } from '@/components/form-fields'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { ApiError, errorMessage } from '@/lib/api/client'
import { ordersApi, type OrderDetail } from '@/lib/api/orders'
import { roleAtLeast } from '@/lib/auth/roles'
import { refundSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'

interface RefundDialogProps {
    order: OrderDetail
    onClose: () => void
    onRefunded: () => void
}

// Refunding is done by the `refund_order` database function: one transaction that marks the order, restocks every line and
// logs the movement. It is safe to retry (a second refund of the same order changes nothing).
function RefundDialog({ order, onClose, onRefunded }: RefundDialogProps) {
    const money = useMoney()
    const form = useForm({ resolver: zodResolver(refundSchema), defaultValues: { reason: '' } })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await ordersApi.refund(order.id, values.reason)
            toast.success('Order refunded and stock restored')
            onRefunded()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to refund order'))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && !submitting && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Refund order {order.order_number}?</DialogTitle>
                    <DialogDescription>
                        The full amount ({money(order.total)}) is refunded and every item goes back into stock. This
                        cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="py-4">
                            <TextField name="reason" label="Reason *" placeholder="e.g. Customer returned the goods" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="destructive" disabled={submitting}>
                                {submitting ? 'Refunding…' : 'Refund order'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function OrderDetailPage() {
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const { user } = useSession()
    const money = useMoney()
    const [refunding, setRefunding] = useState(false)

    const orderQuery = useApiQuery(signal => ordersApi.get(params.id, signal), `order:${params.id}`)

    if (orderQuery.error) {
        if (orderQuery.error instanceof ApiError && orderQuery.error.status === 404) {
            return (
                <div className="text-center py-12">
                    <p className="text-muted-foreground">Order not found</p>
                    <Button onClick={() => router.push('/orders')} className="mt-4">
                        Back to Orders
                    </Button>
                </div>
            )
        }
        return <QueryError error={orderQuery.error} onRetry={orderQuery.reload} />
    }
    if (!orderQuery.data) return <PageSpinner />

    const order = orderQuery.data
    const canRefund = order.status === 'completed' && roleAtLeast(user.role, 'manager')

    return (
        <div className="space-y-6 print:space-y-4">
            <div className="flex items-center justify-between print:hidden">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Back to orders"
                        onClick={() => router.push('/orders')}
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">Order Details</h1>
                        <p className="text-muted-foreground">Order #{order.order_number}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => window.print()}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print
                    </Button>
                    {canRefund && (
                        <Button variant="destructive" onClick={() => setRefunding(true)}>
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
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Created By:</span>
                            <span>{order.created_by_name || 'System'}</span>
                        </div>
                        {order.payments.length > 0 && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Payment:</span>
                                <span className="capitalize">
                                    {order.payments.map(p => `${p.payment_method} (${money(p.amount)})`).join(', ')}
                                </span>
                            </div>
                        )}
                        {order.status === 'refunded' && (
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Refund:</span>
                                <span className="text-right">
                                    {order.refunded_at && format(new Date(order.refunded_at), 'PPp')}
                                    {order.refund_reason && (
                                        <span className="block text-sm text-muted-foreground">
                                            {order.refund_reason}
                                        </span>
                                    )}
                                </span>
                            </div>
                        )}
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
                            {order.items.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.product.name}</TableCell>
                                    <TableCell>{item.variant?.name || '-'}</TableCell>
                                    <TableCell className="text-right">{item.quantity}</TableCell>
                                    <TableCell className="text-right">{money(item.unit_price)}</TableCell>
                                    <TableCell className="text-right">{money(item.discount)}</TableCell>
                                    <TableCell className="text-right">{money(item.tax)}</TableCell>
                                    <TableCell className="text-right font-semibold">{money(item.total)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>

                    <Separator className="my-4" />

                    {/* Order Summary */}
                    <div className="space-y-2 max-w-sm ml-auto">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Subtotal:</span>
                            <span>{money(order.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Tax:</span>
                            <span>{money(order.tax)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Discount:</span>
                            <span className="text-red-600">-{money(order.discount)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between text-lg font-bold">
                            <span>Total:</span>
                            <span className="text-emerald-600">{money(order.total)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {refunding && (
                <RefundDialog
                    order={order}
                    onClose={() => setRefunding(false)}
                    onRefunded={() => {
                        setRefunding(false)
                        orderQuery.reload()
                    }}
                />
            )}
        </div>
    )
}
