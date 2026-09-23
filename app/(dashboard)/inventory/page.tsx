'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle, Gift, PackagePlus, TrendingUp, Warehouse } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { PageHeader } from '@/components/page-header'
import { FilterBar } from '@/components/filter-bar'
import { ResponsiveList, ListCardRow } from '@/components/responsive-list'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useMoney, useSession } from '@/components/session-provider'
import { OfflineDisabledButton } from '@/components/pwa/offline-disabled-button'
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
                            <OfflineDisabledButton type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : t('apply')}
                            </OfflineDisabledButton>
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
            <PageHeader title={t('title')} description={t('subtitle')} />

            <div className="grid grid-cols-1 gap-3 md:gap-4">
                <Card className="gap-2 rounded-2xl py-4 md:gap-6 md:py-6">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-2 md:px-6">
                        <CardTitle className="text-xs font-medium md:text-sm">{t('totalItems')}</CardTitle>
                        <Warehouse className="h-4 w-4 shrink-0 text-emerald-600" />
                    </CardHeader>
                    <CardContent className="px-4 md:px-6">
                        <div className="text-lg font-bold md:text-2xl">{summary?.total_units ?? '-'}</div>
                        <p className="hidden text-xs text-muted-foreground md:block">
                            {t('acrossProducts', { count: summary?.item_count ?? '-' })}
                        </p>
                    </CardContent>
                </Card>

                <Card className="gap-2 rounded-2xl border-red-100 py-4 dark:border-red-900/30 md:gap-6 md:py-6">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-2 md:px-6">
                        <CardTitle className="text-xs font-medium md:text-sm">{t('lowStockAlert')}</CardTitle>
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                    </CardHeader>
                    <CardContent className="px-4 md:px-6">
                        <div className="text-lg font-bold text-red-600 md:text-2xl">
                            {summary?.low_stock_count ?? '-'}
                        </div>
                        <p className="hidden text-xs text-muted-foreground md:block">{t('needRestocking')}</p>
                    </CardContent>
                </Card>

                <Card className="gap-2 rounded-2xl py-4 md:gap-6 md:py-6">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-2 md:px-6">
                        <CardTitle className="text-xs font-medium md:text-sm">{t('stockValue')}</CardTitle>
                        <TrendingUp className="h-4 w-4 shrink-0 text-blue-600" />
                    </CardHeader>
                    <CardContent className="px-4 md:px-6">
                        <div className="truncate text-lg font-bold md:text-2xl">
                            {summary ? money(summary.stock_value) : '-'}
                        </div>
                        <p className="hidden text-xs text-muted-foreground md:block">{t('stockValueHint')}</p>
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
                    <div className="max-h-72 overflow-y-auto rounded-md border">
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

            <FilterBar
                search={searchQuery}
                onSearchChange={value => {
                    setSearchQuery(value)
                    reset()
                }}
                searchPlaceholder={t('searchPlaceholder')}
            >
                <Button
                    variant={lowOnly ? 'default' : 'outline'}
                    aria-pressed={lowOnly}
                    className="w-full lg:w-auto"
                    onClick={() => {
                        setLowOnly(value => !value)
                        reset()
                    }}
                >
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    {t('lowStockOnly')}
                </Button>
            </FilterBar>

            {inventory.error ? (
                <QueryError error={inventory.error} onRetry={inventory.reload} />
            ) : !inventory.data ? (
                <PageSpinner />
            ) : (
                <>
                    <ResponsiveList
                        items={inventory.data.data}
                        keyOf={item => item.id}
                        table={
                            <Card className="rounded-2xl p-6">
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
                                                    <TableCell className="font-mono text-sm">
                                                        {item.product.sku}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span
                                                            className={
                                                                isLowStock ? 'text-red-600 font-bold' : 'font-semibold'
                                                            }
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
                                                    <TableCell>
                                                        {money(item.quantity * item.product.cost_price)}
                                                    </TableCell>
                                                    {canAdjust && (
                                                        <TableCell className="text-right">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                aria-label={t('adjustAria', {
                                                                    name: item.product.name
                                                                })}
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
                            </Card>
                        }
                        renderCard={item => {
                            const isLowStock = item.quantity <= item.low_stock_threshold
                            return (
                                <ListCardRow
                                    title={item.product.name}
                                    subtitle={
                                        item.variant ? `${item.product.sku} · ${item.variant.name}` : item.product.sku
                                    }
                                    value={
                                        <Badge variant={isLowStock ? 'destructive' : 'default'}>
                                            {item.quantity} {isLowStock ? t('lowStock') : t('inStock')}
                                        </Badge>
                                    }
                                    menu={
                                        canAdjust && (
                                            <DropdownMenuItem onClick={() => setAdjusting(item)}>
                                                <PackagePlus className="mr-2 h-4 w-4" />
                                                {t('adjustTitle')}
                                            </DropdownMenuItem>
                                        )
                                    }
                                />
                            )
                        }}
                    />
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
