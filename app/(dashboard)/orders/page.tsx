'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { PageHeader } from '@/components/page-header'
import { FilterBar } from '@/components/filter-bar'
import { ResponsiveList, ListCardRow } from '@/components/responsive-list'
import { useMoney, useSession } from '@/components/session-provider'
import { ordersApi, type OrderListItem } from '@/lib/api/orders'
import { roleAtLeast } from '@/lib/auth/roles'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'

const ALL = 'all'

/** An offline sale that synced with a difference (F2/F4) and no manager has reviewed yet. */
const needsReview = (order: OrderListItem): boolean => order.sync_issues !== null && order.reviewed_at === null

const getStatusColor = (status: string) => {
    switch (status) {
        case 'completed':
            return 'default'
        case 'pending':
            return 'secondary'
        case 'refunded':
            return 'destructive'
        default:
            return 'outline'
    }
}

export default function OrdersPage() {
    const t = useTranslations('orders')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const router = useRouter()
    const { user } = useSession()
    const money = useMoney()
    const [searchQuery, setSearchQuery] = useState('')
    const [status, setStatus] = useState(ALL)
    const canReview = roleAtLeast(user.role, 'manager')
    const [needsReviewOnly, setNeedsReviewOnly] = useState(false)
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const search = useDebouncedValue(searchQuery)

    const orders = useApiQuery(
        signal =>
            ordersApi.list(
                {
                    page,
                    pageSize,
                    q: search,
                    status: status === ALL ? undefined : status,
                    needs_review: canReview && needsReviewOnly ? true : undefined
                },
                signal
            ),
        JSON.stringify({ page, pageSize, search, status, needsReviewOnly: canReview && needsReviewOnly })
    )

    const statusLabel = (value: string) => {
        if (value === 'completed' || value === 'refunded' || value === 'draft' || value === 'pending') {
            return tc(`orderStatus.${value}`)
        }
        return value
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t('title')}
                description={roleAtLeast(user.role, 'manager') ? t('subtitleManage') : t('subtitleOwn')}
            />

            <FilterBar
                search={searchQuery}
                onSearchChange={value => {
                    setSearchQuery(value)
                    reset()
                }}
                searchPlaceholder={t('searchPlaceholder')}
                activeCount={(status === ALL ? 0 : 1) + (canReview && needsReviewOnly ? 1 : 0)}
            >
                <div className="space-y-1.5">
                    <Label className="lg:sr-only">{t('filterStatusAria')}</Label>
                    <Select
                        value={status}
                        onValueChange={value => {
                            setStatus(value)
                            reset()
                        }}
                    >
                        <SelectTrigger className="w-full lg:w-44" aria-label={t('filterStatusAria')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
                            <SelectItem value="completed">{tc('orderStatus.completed')}</SelectItem>
                            <SelectItem value="refunded">{tc('orderStatus.refunded')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {canReview && (
                    <Button
                        variant={needsReviewOnly ? 'default' : 'outline'}
                        aria-pressed={needsReviewOnly}
                        className="w-full lg:w-auto"
                        onClick={() => {
                            setNeedsReviewOnly(value => !value)
                            reset()
                        }}
                    >
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        {t('needsReviewOnly')}
                    </Button>
                )}
            </FilterBar>

            {orders.error ? (
                <QueryError error={orders.error} onRetry={orders.reload} />
            ) : !orders.data ? (
                <PageSpinner />
            ) : (
                <>
                    <ResponsiveList
                        items={orders.data.data}
                        keyOf={order => order.id}
                        table={
                            <Card className="rounded-2xl p-6">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('colOrder')}</TableHead>
                                            <TableHead>{t('colCustomer')}</TableHead>
                                            <TableHead>{t('colDate')}</TableHead>
                                            <TableHead>{t('colTotal')}</TableHead>
                                            <TableHead>{t('colStatus')}</TableHead>
                                            <TableHead className="text-right">{tc('actions')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {orders.data.data.map(order => (
                                            <TableRow
                                                key={order.id}
                                                className="cursor-pointer hover:bg-muted/50"
                                                onClick={() => router.push(`/orders/${order.id}`)}
                                            >
                                                <TableCell className="font-mono font-medium">
                                                    {order.order_number}
                                                </TableCell>
                                                <TableCell>
                                                    {order.customer?.name || order.debtor_name || t('walkIn')}
                                                </TableCell>
                                                <TableCell>
                                                    {format(new Date(order.created_at), 'MMM dd, yyyy HH:mm', {
                                                        locale: dateLocale
                                                    })}
                                                </TableCell>
                                                <TableCell className="font-bold text-emerald-600">
                                                    {money(order.total)}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        <Badge variant={getStatusColor(order.status)}>
                                                            {statusLabel(order.status)}
                                                        </Badge>
                                                        {needsReview(order) && (
                                                            <Badge variant="outline" className="gap-1">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                {t('needsReview')}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t('viewAria', {
                                                                orderNumber: order.order_number
                                                            })}
                                                            onClick={e => {
                                                                e.stopPropagation()
                                                                router.push(`/orders/${order.id}`)
                                                            }}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Card>
                        }
                        renderCard={order => (
                            <ListCardRow
                                href={`/orders/${order.id}`}
                                title={order.order_number}
                                subtitle={`${order.customer?.name || order.debtor_name || t('walkIn')} · ${format(
                                    new Date(order.created_at),
                                    'MMM dd, HH:mm',
                                    { locale: dateLocale }
                                )}`}
                                value={
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="font-bold text-emerald-600">{money(order.total)}</span>
                                        <Badge variant={getStatusColor(order.status)}>
                                            {statusLabel(order.status)}
                                        </Badge>
                                        {needsReview(order) && (
                                            <Badge variant="outline" className="gap-1">
                                                <AlertTriangle className="h-3 w-3" />
                                                {t('needsReview')}
                                            </Badge>
                                        )}
                                    </div>
                                }
                            />
                        )}
                    />
                    {orders.data.data.length === 0 && (
                        <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
                    )}
                    <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={orders.data.total}
                        onPageChange={setPage}
                        onPageSizeChange={setPageSize}
                    />
                </>
            )}
        </div>
    )
}
