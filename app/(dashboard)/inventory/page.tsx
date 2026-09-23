'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle, Gift, PackagePlus, Search, TrendingUp, Warehouse } from 'lucide-react'
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
import { promotionsApi } from '@/lib/api/promotions'
import { roleAtLeast } from '@/lib/auth/roles'
import { inventoryAdjustSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'

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
    const t = useTranslations('inventory')
    const tc = useTranslations('common')
    const form = useForm<AdjustInput, unknown, AdjustOutput>({
        resolver: zodResolver(inventoryAdjustSchema),
        defaultValues: { delta: undefined, reason: '' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            const { quantity } = await inventoryApi.adjust(item.id, values)
            toast.success(t('stockUpdated', { name: item.product.name, quantity }))
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('adjustFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('adjustTitle')}</DialogTitle>
                    <DialogDescription>
                        {t('adjustDescription', { name: item.product.name, quantity: item.quantity })}
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField
                                name="delta"
                                label={t('changeLabel')}
                                type="number"
                                step="1"
                                placeholder={t('changePlaceholder')}
                            />
                            <TextField name="reason" label={t('reasonLabel')} placeholder={t('reasonPlaceholder')} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : t('apply')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function InventoryPage() {
    const t = useTranslations('inventory')
    const tc = useTranslations('common')
    const { user } = useSession()
    const money = useMoney()
    const canAdjust = roleAtLeast(user.role, 'manager')

    const [searchQuery, setSearchQuery] = useState('')
    const [lowOnly, setLowOnly] = useState(false)
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const [adjusting, setAdjusting] = useState<InventoryListItem | null>(null)
    const search = useDebouncedValue(searchQuery)

    const inventory = useApiQuery(
        signal => inventoryApi.list({ page, pageSize, q: search, low: lowOnly }, signal),
        JSON.stringify({ page, pageSize, search, lowOnly })
    )
    const summary = inventory.data?.summary
    const sellablePackages = useApiQuery(
        signal => promotionsApi.list({ pageSize: 100, active: true }, signal),
        'inventory-sellable-packages'
    )

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('totalItems')}</CardTitle>
                        <Warehouse className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary?.total_units ?? '-'}</div>
                        <p className="text-xs text-muted-foreground">
                            {t('acrossProducts', { count: summary?.item_count ?? '-' })}
                        </p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl border-red-100 dark:border-red-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('lowStockAlert')}</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{summary?.low_stock_count ?? '-'}</div>
                        <p className="text-xs text-muted-foreground">{t('needRestocking')}</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{t('stockValue')}</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary ? money(summary.stock_value) : '-'}</div>
                        <p className="text-xs text-muted-foreground">{t('stockValueHint')}</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-start gap-3 mb-4">
                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 shrink-0">
                        <Gift className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold">{t('packagesSection')}</h2>
                        <p className="text-sm text-muted-foreground">{t('packagesSectionHint')}</p>
                        {sellablePackages.data && sellablePackages.data.data.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                                {t('packagesCount', { count: sellablePackages.data.data.length })}
                            </p>
                        )}
                    </div>
                </div>
                {sellablePackages.error ? (
                    <QueryError error={sellablePackages.error} onRetry={sellablePackages.reload} />
                ) : !sellablePackages.data ? (
                    <PageSpinner />
                ) : sellablePackages.data.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('packagesEmpty')}</p>
                ) : (
                    <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="sticky top-0 z-10 bg-card">{t('packagesColName')}</TableHead>
                                    <TableHead className="sticky top-0 z-10 bg-card">
                                        {t('packagesColRecipe')}
                                    </TableHead>
                                    <TableHead className="sticky top-0 z-10 bg-card">
                                        {t('packagesColAvailable')}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sellablePackages.data.data.map(promo => {
                                    const recipe = promo.items
                                        .map(
                                            item =>
                                                `${item.quantity}× ${item.product?.name ?? '—'} (stock ${item.product?.stock ?? '—'})`
                                        )
                                        .join(' · ')
                                    return (
                                        <TableRow key={promo.id}>
                                            <TableCell className="font-medium">{promo.name}</TableCell>
                                            <TableCell
                                                className="text-sm text-muted-foreground max-w-md"
                                                title={recipe}
                                            >
                                                <span className="line-clamp-2">{recipe}</span>
                                            </TableCell>
                                            <TableCell>
                                                {promo.available === null ? (
                                                    <span className="text-muted-foreground">
                                                        {t('packagesUnavailable')}
                                                    </span>
                                                ) : (
                                                    <Badge variant={promo.available <= 0 ? 'destructive' : 'secondary'}>
                                                        {promo.available}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={t('searchPlaceholder')}
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                reset()
                            }}
                            className="pl-10"
                        />
                    </div>
                    <Button
                        variant={lowOnly ? 'default' : 'outline'}
                        aria-pressed={lowOnly}
                        onClick={() => {
                            setLowOnly(value => !value)
                            reset()
                        }}
                    >
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        {t('lowStockOnly')}
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
                                    <TableHead>{t('product')}</TableHead>
                                    <TableHead>{t('sku')}</TableHead>
                                    <TableHead>{t('quantity')}</TableHead>
                                    <TableHead>{t('minThreshold')}</TableHead>
                                    <TableHead>{tc('status')}</TableHead>
                                    <TableHead>{t('value')}</TableHead>
                                    {canAdjust && <TableHead className="text-right">{tc('actions')}</TableHead>}
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
                                                    {isLowStock ? t('lowStock') : t('inStock')}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{money(item.quantity * item.product.cost_price)}</TableCell>
                                            {canAdjust && (
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label={t('adjustAria', { name: item.product.name })}
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
                            <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={pageSize}
                            total={inventory.data.total}
                            onPageChange={setPage}
                            onPageSizeChange={setPageSize}
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
