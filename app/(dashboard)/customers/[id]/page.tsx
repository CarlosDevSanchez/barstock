'use client'

import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
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
    const t = useTranslations('customers')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const money = useMoney()

    const customerQuery = useApiQuery(signal => customersApi.get(params.id, signal), `customer:${params.id}`)
    // Cashiers only receive their own orders (RLS); managers and admins receive all of them.
    const ordersQuery = useApiQuery(
        signal => ordersApi.list({ customer_id: params.id, pageSize: 100 }, signal),
        `customer-orders:${params.id}`
    )

    const statusLabel = (value: string) => {
        if (value === 'completed' || value === 'refunded' || value === 'draft' || value === 'pending') {
            return tc(`orderStatus.${value}`)
        }
        return value
    }

    if (customerQuery.error) {
        if (customerQuery.error instanceof ApiError && customerQuery.error.status === 404) {
            return (
                <div className="text-center py-12">
                    <p className="text-muted-foreground">{t('notFound')}</p>
                    <Button onClick={() => router.push('/customers')} className="mt-4">
                        {t('backToCustomers')}
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
                    aria-label={t('backAria')}
                    onClick={() => router.push('/customers')}
                >
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">{customer.name}</h1>
                    <p className="text-muted-foreground">{t('detailsSubtitle')}</p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('totalSpent')}</CardTitle>
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{money(customer.total_spent)}</div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('totalOrders')}</CardTitle>
                        <ShoppingBag className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{completedOrders}</div>
                        <p className="text-xs text-muted-foreground">{t('ofTotal', { count: totalOrders })}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('loyaltyPoints')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-purple-600">{customer.loyalty_points}</div>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{tc('status')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Badge variant={customer.is_active ? 'default' : 'secondary'} className="text-sm">
                            {customer.is_active ? tc('active') : tc('inactive')}
                        </Badge>
                    </CardContent>
                </Card>
            </div>

            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle>{t('contactInfo')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                    <div>
                        <p className="text-sm text-muted-foreground">{t('email')}</p>
                        <p className="font-medium">{customer.email || '-'}</p>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">{t('phone')}</p>
                        <p className="font-medium">{customer.phone || '-'}</p>
                    </div>
                    <div className="md:col-span-2">
                        <p className="text-sm text-muted-foreground">{t('address')}</p>
                        <p className="font-medium">{customer.address || '-'}</p>
                    </div>
                </CardContent>
            </Card>

            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle>{t('purchaseHistory')}</CardTitle>
                </CardHeader>
                <CardContent>
                    {orders.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">{t('noHistory')}</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('colOrder')}</TableHead>
                                    <TableHead>{t('colDate')}</TableHead>
                                    <TableHead>{t('colStatus')}</TableHead>
                                    <TableHead className="text-right">{t('colTotal')}</TableHead>
                                    <TableHead className="text-right">{tc('actions')}</TableHead>
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
                                        <TableCell>
                                            {format(new Date(order.created_at), 'MMM dd, yyyy', {
                                                locale: dateLocale
                                            })}
                                        </TableCell>
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
                                                {statusLabel(order.status)}
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
                                                {t('view')}
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
