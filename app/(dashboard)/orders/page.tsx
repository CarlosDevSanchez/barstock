'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { Search, Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { ordersApi } from '@/lib/api/orders'
import { roleAtLeast } from '@/lib/auth/roles'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const PAGE_SIZE = 25
const ALL = 'all'

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
    const router = useRouter()
    const { user } = useSession()
    const money = useMoney()
    const [searchQuery, setSearchQuery] = useState('')
    const [status, setStatus] = useState(ALL)
    const [page, setPage] = useState(1)
    const search = useDebouncedValue(searchQuery)

    const orders = useApiQuery(
        signal =>
            ordersApi.list(
                { page, pageSize: PAGE_SIZE, q: search, status: status === ALL ? undefined : status },
                signal
            ),
        JSON.stringify({ page, search, status })
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Orders</h1>
                    <p className="text-muted-foreground">
                        {roleAtLeast(user.role, 'manager') ? 'View and manage all sales orders' : 'Your sales orders'}
                    </p>
                </div>
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by order number..."
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                setPage(1)
                            }}
                            className="pl-10"
                        />
                    </div>
                    <Select
                        value={status}
                        onValueChange={value => {
                            setStatus(value)
                            setPage(1)
                        }}
                    >
                        <SelectTrigger className="w-44" aria-label="Filter by status">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All statuses</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="refunded">Refunded</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {orders.error ? (
                    <QueryError error={orders.error} onRetry={orders.reload} />
                ) : !orders.data ? (
                    <PageSpinner />
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Order #</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Total</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {orders.data.data.map(order => (
                                    <TableRow
                                        key={order.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => router.push(`/orders/${order.id}`)}
                                    >
                                        <TableCell className="font-mono font-medium">{order.order_number}</TableCell>
                                        <TableCell>{order.customer?.name || 'Walk-in'}</TableCell>
                                        <TableCell>
                                            {format(new Date(order.created_at), 'MMM dd, yyyy HH:mm')}
                                        </TableCell>
                                        <TableCell className="font-bold text-emerald-600">
                                            {money(order.total)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={getStatusColor(order.status)}>{order.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    aria-label={`View order ${order.order_number}`}
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
                        {orders.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">No orders found</p>
                        )}
                        <Pagination page={page} pageSize={PAGE_SIZE} total={orders.data.total} onPageChange={setPage} />
                    </>
                )}
            </Card>
        </div>
    )
}
