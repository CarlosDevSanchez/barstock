'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, PackagePlus, Search, TrendingUp, Warehouse } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { inventoryApi, type InventoryListItem } from '@/lib/api/inventory'
import { roleAtLeast } from '@/lib/auth/roles'
import { inventoryAdjustSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const PAGE_SIZE = 25

type AdjustInput = z.input<typeof inventoryAdjustSchema>
type AdjustOutput = z.output<typeof inventoryAdjustSchema>

interface AdjustDialogProps {
    item: InventoryListItem
    onClose: () => void
    onSaved: () => void
}

// Stock never changes through a plain UPDATE: the adjustment goes through a database function that records who, why and how
// much, and refuses to make the stock negative.
function AdjustDialog({ item, onClose, onSaved }: AdjustDialogProps) {
    const form = useForm<AdjustInput, unknown, AdjustOutput>({
        resolver: zodResolver(inventoryAdjustSchema),
        defaultValues: { delta: undefined, reason: '' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            const { quantity } = await inventoryApi.adjust(item.id, values)
            toast.success(`Stock updated: ${item.product.name} now has ${quantity}`)
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to adjust stock'))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Adjust stock</DialogTitle>
                    <DialogDescription>
                        {item.product.name} · currently {item.quantity} in stock. Use a positive number to add units and
                        a negative one to remove them.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField
                                name="delta"
                                label="Change (units) *"
                                type="number"
                                step="1"
                                placeholder="e.g. 12 or -3"
                            />
                            <TextField
                                name="reason"
                                label="Reason *"
                                placeholder="e.g. New delivery, damaged, recount"
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Saving…' : 'Apply adjustment'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function InventoryPage() {
    const { user } = useSession()
    const money = useMoney()
    const canAdjust = roleAtLeast(user.role, 'manager')

    const [searchQuery, setSearchQuery] = useState('')
    const [lowOnly, setLowOnly] = useState(false)
    const [page, setPage] = useState(1)
    const [adjusting, setAdjusting] = useState<InventoryListItem | null>(null)
    const search = useDebouncedValue(searchQuery)

    const inventory = useApiQuery(
        signal => inventoryApi.list({ page, pageSize: PAGE_SIZE, q: search, low: lowOnly }, signal),
        JSON.stringify({ page, search, lowOnly })
    )
    const summary = inventory.data?.summary

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Inventory Management</h1>
                <p className="text-muted-foreground">Track and manage your stock levels</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Items</CardTitle>
                        <Warehouse className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary?.total_units ?? '-'}</div>
                        <p className="text-xs text-muted-foreground">Across {summary?.item_count ?? '-'} products</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl border-red-100 dark:border-red-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Low Stock Alert</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{summary?.low_stock_count ?? '-'}</div>
                        <p className="text-xs text-muted-foreground">Products need restocking</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary ? money(summary.stock_value) : '-'}</div>
                        <p className="text-xs text-muted-foreground">Total inventory value (at cost)</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by product name or SKU..."
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                setPage(1)
                            }}
                            className="pl-10"
                        />
                    </div>
                    <Button
                        variant={lowOnly ? 'default' : 'outline'}
                        aria-pressed={lowOnly}
                        onClick={() => {
                            setLowOnly(value => !value)
                            setPage(1)
                        }}
                    >
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        Low stock only
                    </Button>
                </div>

                {inventory.error ? (
                    <QueryError error={inventory.error} onRetry={inventory.reload} />
                ) : !inventory.data ? (
                    <PageSpinner />
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Quantity</TableHead>
                                    <TableHead>Min Threshold</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Value</TableHead>
                                    {canAdjust && <TableHead className="text-right">Actions</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {inventory.data.data.map(item => {
                                    const isLowStock = item.quantity <= item.low_stock_threshold
                                    return (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">
                                                {item.product.name}
                                                {item.variant && (
                                                    <span className="text-muted-foreground">
                                                        {' '}
                                                        · {item.variant.name}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">{item.product.sku}</TableCell>
                                            <TableCell>
                                                <span
                                                    className={isLowStock ? 'text-red-600 font-bold' : 'font-semibold'}
                                                >
                                                    {item.quantity}
                                                </span>
                                            </TableCell>
                                            <TableCell>{item.low_stock_threshold}</TableCell>
                                            <TableCell>
                                                <Badge variant={isLowStock ? 'destructive' : 'default'}>
                                                    {isLowStock ? 'Low Stock' : 'In Stock'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{money(item.quantity * item.product.cost_price)}</TableCell>
                                            {canAdjust && (
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label={`Adjust stock of ${item.product.name}`}
                                                        onClick={() => setAdjusting(item)}
                                                    >
                                                        <PackagePlus className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                        {inventory.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">No inventory found</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={inventory.data.total}
                            onPageChange={setPage}
                        />
                    </>
                )}
            </Card>

            {adjusting && (
                <AdjustDialog
                    key={adjusting.id}
                    item={adjusting}
                    onClose={() => setAdjusting(null)}
                    onSaved={() => {
                        setAdjusting(null)
                        inventory.reload()
                    }}
                />
            )}
        </div>
    )
}
