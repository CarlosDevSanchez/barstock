'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
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
import { ReceiptTicket } from '@/components/orders/receipt-ticket'
import { useMoney, useSession } from '@/components/session-provider'
import { ApiError, errorMessage } from '@/lib/api/client'
import { ordersApi, type OrderDetail } from '@/lib/api/orders'
import { roleAtLeast } from '@/lib/auth/roles'
import { groupOrderItemsByPromotion } from '@/lib/order-item-groups'
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
    const t = useTranslations('orders')
    const tc = useTranslations('common')
    const money = useMoney()
    const form = useForm({ resolver: zodResolver(refundSchema), defaultValues: { reason: '' } })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await ordersApi.refund(order.id, values.reason)
            toast.success(t('refundedToast'))
            onRefunded()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('refundFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && !submitting && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('refundTitle', { orderNumber: order.order_number })}</DialogTitle>
                    <DialogDescription>{t('refundDescription', { total: money(order.total) })}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="py-4">
                            <TextField name="reason" label={t('reasonLabel')} placeholder={t('reasonPlaceholder')} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" variant="destructive" disabled={submitting}>
                                {submitting ? t('refunding') : t('refundOrder')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function OrderDetailPage() {
    const t = useTranslations('orders')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const { user, settings } = useSession()
    const money = useMoney()
    const [refunding, setRefunding] = useState(false)

    const orderQuery = useApiQuery(signal => ordersApi.get(params.id, signal), `order:${params.id}`)

    const statusLabel = (value: string) => {
        if (value === 'completed' || value === 'refunded' || value === 'draft' || value === 'pending') {
            return tc(`orderStatus.${value}`)
        }
        return value
    }

    const paymentLabel = (method: string) => {
        if (method === 'cash' || method === 'card' || method === 'ewallet') {
            return tc(`payment.${method}`)
        }
        return method
    }

    if (orderQuery.error) {
        if (orderQuery.error instanceof ApiError && orderQuery.error.status === 404) {
            return (
                <div className="text-center py-12">
                    <p className="text-muted-foreground">{t('notFound')}</p>
                    <Button onClick={() => router.push('/orders')} className="mt-4">
                        {t('backToOrders')}
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
        <div className="space-y-6">
            <div className="print:hidden space-y-6" data-testid="order-detail-view">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('backAria')}
                            onClick={() => router.push('/orders')}
                            className="hidden lg:inline-flex"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="min-w-0">
                            <h1 className="text-xl font-bold truncate lg:text-3xl">{t('detailsTitle')}</h1>
                            <p className="text-muted-foreground truncate">
                                {t('orderNumberSubtitle', { orderNumber: order.order_number })}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => window.print()}>
                            <Printer className="mr-2 h-4 w-4" />
                            {t('print')}
                        </Button>
                        {canRefund && (
                            <Button variant="destructive" onClick={() => setRefunding(true)}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                {t('refund')}
                            </Button>
                        )}
                    </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <Card className="min-w-0 rounded-2xl">
                        <CardHeader>
                            <CardTitle>{t('orderInfo')}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{t('orderNumber')}</span>
                                <span className="min-w-0 truncate text-right font-semibold">{order.order_number}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{t('date')}</span>
                                <span className="min-w-0 break-words text-right">
                                    {format(new Date(order.created_at), 'PPp', { locale: dateLocale })}
                                </span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{t('status')}</span>
                                <Badge
                                    variant={
                                        order.status === 'completed'
                                            ? 'default'
                                            : order.status === 'refunded'
                                              ? 'destructive'
                                              : 'secondary'
                                    }
                                >
                                    {statusLabel(order.status)}
                                </Badge>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{t('createdBy')}</span>
                                <span className="min-w-0 break-words text-right">
                                    {order.created_by_name || t('system')}
                                </span>
                            </div>
                            {order.payments.length > 0 && (
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">{t('payment')}</span>
                                    <span className="min-w-0 break-words text-right">
                                        {order.payments
                                            .map(p => `${paymentLabel(p.payment_method)} (${money(p.amount)})`)
                                            .join(', ')}
                                    </span>
                                </div>
                            )}
                            {order.tab && (
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">{t('tab')}</span>
                                    <span className="min-w-0 break-words text-right">
                                        {t('tabValue', { tabNumber: order.tab.tab_number, label: order.tab.label })}
                                    </span>
                                </div>
                            )}
                            {order.status === 'refunded' && (
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">{t('refundLabel')}</span>
                                    <span className="min-w-0 break-words text-right">
                                        {order.refunded_at &&
                                            format(new Date(order.refunded_at), 'PPp', { locale: dateLocale })}
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

                    <Card className="min-w-0 rounded-2xl">
                        <CardHeader>
                            <CardTitle>{t('customerInfo')}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">{t('name')}</span>
                                <span className="min-w-0 truncate text-right font-semibold">
                                    {order.customer?.name || t('walkInCustomer')}
                                </span>
                            </div>
                            {order.customer?.email && (
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">{t('email')}</span>
                                    <span className="min-w-0 truncate text-right">{order.customer.email}</span>
                                </div>
                            )}
                            {order.customer?.phone && (
                                <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">{t('phone')}</span>
                                    <span className="min-w-0 truncate text-right">{order.customer.phone}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Receipt className="h-5 w-5 text-emerald-600" />
                            {t('orderItems')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('colProduct')}</TableHead>
                                    <TableHead>{t('colVariant')}</TableHead>
                                    <TableHead className="text-right">{t('colQty')}</TableHead>
                                    <TableHead className="text-right">{t('colPrice')}</TableHead>
                                    <TableHead className="text-right">{t('colDiscount')}</TableHead>
                                    <TableHead className="text-right">{t('colTax')}</TableHead>
                                    <TableHead className="text-right">{t('colTotal')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {groupOrderItemsByPromotion(order.items).flatMap(group => {
                                    if (group.kind === 'product') {
                                        const item = group.item
                                        return [
                                            <TableRow key={item.id}>
                                                <TableCell className="font-medium">{item.product.name}</TableCell>
                                                <TableCell>{item.variant?.name || '-'}</TableCell>
                                                <TableCell className="text-right">{item.quantity}</TableCell>
                                                <TableCell className="text-right">{money(item.unit_price)}</TableCell>
                                                <TableCell className="text-right">{money(item.discount)}</TableCell>
                                                <TableCell className="text-right">{money(item.tax)}</TableCell>
                                                <TableCell className="text-right font-semibold">
                                                    {money(item.total)}
                                                </TableCell>
                                            </TableRow>
                                        ]
                                    }
                                    return [
                                        <TableRow key={`promo-${group.promotionId}`} className="bg-muted/40">
                                            <TableCell className="font-medium" colSpan={2}>
                                                {t('promoGroup', {
                                                    name: group.name,
                                                    count: group.packageQty
                                                })}
                                            </TableCell>
                                            <TableCell className="text-right">{group.packageQty}</TableCell>
                                            <TableCell className="text-right">—</TableCell>
                                            <TableCell className="text-right">—</TableCell>
                                            <TableCell className="text-right">—</TableCell>
                                            <TableCell className="text-right font-semibold">
                                                {money(group.total)}
                                            </TableCell>
                                        </TableRow>,
                                        ...group.items.map(item => (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-medium pl-6 text-muted-foreground">
                                                    {item.product.name}
                                                </TableCell>
                                                <TableCell>{item.variant?.name || '-'}</TableCell>
                                                <TableCell className="text-right">{item.quantity}</TableCell>
                                                <TableCell className="text-right">{money(item.unit_price)}</TableCell>
                                                <TableCell className="text-right">{money(item.discount)}</TableCell>
                                                <TableCell className="text-right">{money(item.tax)}</TableCell>
                                                <TableCell className="text-right font-semibold">
                                                    {money(item.total)}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ]
                                })}
                            </TableBody>
                        </Table>

                        <Separator className="my-4" />

                        <div className="space-y-2 max-w-sm ml-auto">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">{t('subtotal')}</span>
                                <span>{money(order.subtotal)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">{t('tax')}</span>
                                <span>{money(order.tax)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">{t('discount')}</span>
                                <span className="text-red-600">-{money(order.discount)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between text-lg font-bold">
                                <span>{t('total')}</span>
                                <span className="text-emerald-600">{money(order.total)}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <ReceiptTicket order={order} settings={settings} />

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
