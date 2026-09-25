'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle, Gift, PackagePlus, Pencil, ShoppingCart, TrendingUp, Warehouse } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { cashApi } from '@/lib/api/cash'
import { inventoryApi, type InventoryListItem } from '@/lib/api/inventory'
import { promotionsApi } from '@/lib/api/promotions'
import { purchasesApi } from '@/lib/api/purchases'
import { suppliersApi } from '@/lib/api/suppliers'
import { roleAtLeast } from '@/lib/auth/roles'
import { purchaseReceiveSchema } from '@/lib/validation/purchases'
import { inventoryAdjustSchema, inventoryThresholdSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'

type AdjustInput = z.input<typeof inventoryAdjustSchema>
type AdjustOutput = z.output<typeof inventoryAdjustSchema>
type ThresholdInput = z.input<typeof inventoryThresholdSchema>
type ThresholdOutput = z.output<typeof inventoryThresholdSchema>

function useLowStockQueryFlag(): boolean {
    return useSyncExternalStore(
        onStoreChange => {
            window.addEventListener('popstate', onStoreChange)
            return () => window.removeEventListener('popstate', onStoreChange)
        },
        () => new URLSearchParams(window.location.search).get('low') === '1',
        () => false
    )
}

interface AdjustDialogProps {
    item: InventoryListItem
    onClose: () => void
    onSaved: () => void
}

function AdjustDialog({ item, onClose, onSaved }: AdjustDialogProps) {
    const t = useTranslations('inventory')
    const tc = useTranslations('common')
    const money = useMoney()
    const [mode, setMode] = useState<'adjust' | 'purchase'>('adjust')
    const [supplierId, setSupplierId] = useState('')
    const [unitCost, setUnitCost] = useState(String(item.product.cost_price))
    const [invoice, setInvoice] = useState('')
    const [fromTill, setFromTill] = useState(false)
    const [sessionId, setSessionId] = useState('')
    const [pendingPurchase, setPendingPurchase] = useState(false)

    const form = useForm<AdjustInput, unknown, AdjustOutput>({
        resolver: zodResolver(inventoryAdjustSchema),
        defaultValues: { delta: undefined, reason: '' }
    })
    const submitting = form.formState.isSubmitting
    const delta = useWatch({ control: form.control, name: 'delta' })
    const deltaNum = typeof delta === 'number' ? delta : Number(delta)
    const showPurchaseOption = Number.isFinite(deltaNum) && deltaNum > 0

    const suppliers = useApiQuery(signal => suppliersApi.list({ pageSize: 100 }, signal), 'purchase-suppliers')
    const desk = useApiQuery(signal => cashApi.current(signal), 'purchase-cash-desk')
    const sessions = desk.data?.sessions ?? []
    const selectedSupplier = supplierId || suppliers.data?.data[0]?.id || ''
    const selectedSession = sessionId || sessions[0]?.id || ''
    const parsedCost = Number(unitCost)
    const costMismatch =
        Number.isFinite(parsedCost) && Math.round(parsedCost * 100) !== Math.round(item.product.cost_price * 100)

    const onSubmit = form.handleSubmit(async values => {
        try {
            const { quantity } = await inventoryApi.adjust(item.id, values)
            toast.success(t('stockUpdated', { name: item.product.name, quantity }))
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('adjustFailed')))
        }
    })

    const onPurchase = async () => {
        const parsed = purchaseReceiveSchema.safeParse({
            supplier_id: selectedSupplier,
            items: [{ product_id: item.product.id, quantity: deltaNum, unit_cost: unitCost }],
            invoice_number: invoice || null,
            notes: null,
            cash_session_id: fromTill ? selectedSession || null : null
        })
        if (!parsed.success) {
            toast.error(errorMessage(parsed.error, t('purchaseFailed')))
            return
        }
        setPendingPurchase(true)
        try {
            await purchasesApi.receive(parsed.data)
            toast.success(t('purchaseSaved'))
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('purchaseFailed')))
        } finally {
            setPendingPurchase(false)
        }
    }

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{mode === 'purchase' ? t('supplierEntry') : t('adjustTitle')}</DialogTitle>
                    <DialogDescription>
                        {t('adjustDescription', { name: item.product.name, quantity: item.quantity })}
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={mode === 'purchase' ? event => event.preventDefault() : onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField
                                name="delta"
                                label={t('changeLabel')}
                                type="number"
                                step="1"
                                placeholder={t('changePlaceholder')}
                            />
                            {showPurchaseOption && (
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={mode === 'adjust' ? 'default' : 'outline'}
                                        onClick={() => setMode('adjust')}
                                    >
                                        {t('asAdjustment')}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={mode === 'purchase' ? 'default' : 'outline'}
                                        onClick={() => setMode('purchase')}
                                    >
                                        {t('asPurchase')}
                                    </Button>
                                </div>
                            )}
                            {mode === 'purchase' && showPurchaseOption ? (
                                <>
                                    <div className="space-y-1">
                                        <Label htmlFor="adj-supplier">{t('supplier')}</Label>
                                        <select
                                            id="adj-supplier"
                                            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                                            value={selectedSupplier}
                                            onChange={event => setSupplierId(event.target.value)}
                                        >
                                            {(suppliers.data?.data ?? []).map(supplier => (
                                                <option key={supplier.id} value={supplier.id}>
                                                    {supplier.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="adj-cost">{t('unitCost')}</Label>
                                        <Input
                                            id="adj-cost"
                                            inputMode="decimal"
                                            value={unitCost}
                                            onChange={event => setUnitCost(event.target.value)}
                                        />
                                    </div>
                                    {costMismatch && (
                                        <p className="text-sm text-muted-foreground">
                                            {t('costMismatch', {
                                                purchase: money(parsedCost),
                                                catalog: money(item.product.cost_price)
                                            })}
                                        </p>
                                    )}
                                    <div className="space-y-1">
                                        <Label htmlFor="adj-invoice">{t('invoice')}</Label>
                                        <Input
                                            id="adj-invoice"
                                            value={invoice}
                                            placeholder={t('invoicePlaceholder')}
                                            onChange={event => setInvoice(event.target.value)}
                                        />
                                    </div>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={fromTill}
                                            onChange={event => setFromTill(event.target.checked)}
                                        />
                                        {t('paidFromTill')}
                                    </label>
                                    {fromTill ? (
                                        sessions.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">{t('noOpenTill')}</p>
                                        ) : (
                                            <div className="space-y-1">
                                                <Label htmlFor="adj-till">{t('till')}</Label>
                                                <select
                                                    id="adj-till"
                                                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                                                    value={selectedSession}
                                                    onChange={event => setSessionId(event.target.value)}
                                                >
                                                    {sessions.map(session => (
                                                        <option key={session.id} value={session.id}>
                                                            {session.register_name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )
                                    ) : null}
                                </>
                            ) : (
                                <TextField
                                    name="reason"
                                    label={t('reasonLabel')}
                                    placeholder={t('reasonPlaceholder')}
                                />
                            )}
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            {mode === 'purchase' && showPurchaseOption ? (
                                <OfflineDisabledButton
                                    type="button"
                                    disabled={pendingPurchase || !selectedSupplier}
                                    onClick={onPurchase}
                                >
                                    {pendingPurchase ? tc('saving') : t('savePurchase')}
                                </OfflineDisabledButton>
                            ) : (
                                <OfflineDisabledButton type="submit" disabled={submitting}>
                                    {submitting ? tc('saving') : t('apply')}
                                </OfflineDisabledButton>
                            )}
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

function ThresholdDialog({ item, onClose, onSaved }: AdjustDialogProps) {
    const t = useTranslations('inventory')
    const tc = useTranslations('common')
    const form = useForm<ThresholdInput, unknown, ThresholdOutput>({
        resolver: zodResolver(inventoryThresholdSchema),
        defaultValues: { low_stock_threshold: String(item.low_stock_threshold) }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await inventoryApi.setThreshold(item.id, values)
            toast.success(t('thresholdSaved'))
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('thresholdFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('thresholdTitle')}</DialogTitle>
                    <DialogDescription>{item.product.name}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate className="space-y-4">
                        <TextField
                            name="low_stock_threshold"
                            label={t('minThreshold')}
                            type="number"
                            min="0"
                            step="1"
                        />
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : tc('save')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

interface PurchaseLine {
    product_id: string
    quantity: string
    unit_cost: string
}

function RegisterPurchaseDialog({
    products,
    onClose,
    onSaved
}: {
    products: InventoryListItem[]
    onClose: () => void
    onSaved: () => void
}) {
    const t = useTranslations('inventory')
    const tc = useTranslations('common')
    const money = useMoney()
    const [supplierId, setSupplierId] = useState('')
    const [invoice, setInvoice] = useState('')
    const [notes, setNotes] = useState('')
    const [fromTill, setFromTill] = useState(false)
    const [sessionId, setSessionId] = useState('')
    const [pending, setPending] = useState(false)
    const [lines, setLines] = useState<PurchaseLine[]>([
        {
            product_id: products[0]?.product.id ?? '',
            quantity: '1',
            unit_cost: String(products[0]?.product.cost_price ?? 0)
        }
    ])

    const suppliers = useApiQuery(signal => suppliersApi.list({ pageSize: 100 }, signal), 'multi-purchase-suppliers')
    const desk = useApiQuery(signal => cashApi.current(signal), 'multi-purchase-cash-desk')
    const sessions = desk.data?.sessions ?? []
    const selectedSupplier = supplierId || suppliers.data?.data[0]?.id || ''
    const selectedSession = sessionId || sessions[0]?.id || ''
    const productById = useMemo(() => new Map(products.map(item => [item.product.id, item.product])), [products])

    const onSave = async () => {
        const parsed = purchaseReceiveSchema.safeParse({
            supplier_id: selectedSupplier,
            items: lines.map(line => ({
                product_id: line.product_id,
                quantity: line.quantity,
                unit_cost: line.unit_cost
            })),
            invoice_number: invoice || null,
            notes: notes || null,
            cash_session_id: fromTill ? selectedSession || null : null
        })
        if (!parsed.success) {
            toast.error(errorMessage(parsed.error, t('purchaseFailed')))
            return
        }
        setPending(true)
        try {
            await purchasesApi.receive(parsed.data)
            toast.success(t('purchaseSaved'))
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('purchaseFailed')))
        } finally {
            setPending(false)
        }
    }

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('registerPurchase')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="po-supplier">{t('supplier')}</Label>
                        <select
                            id="po-supplier"
                            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                            value={selectedSupplier}
                            onChange={event => setSupplierId(event.target.value)}
                        >
                            {(suppliers.data?.data ?? []).map(supplier => (
                                <option key={supplier.id} value={supplier.id}>
                                    {supplier.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {lines.map((line, index) => {
                        const catalog = productById.get(line.product_id)
                        const cost = Number(line.unit_cost)
                        const mismatch =
                            catalog &&
                            Number.isFinite(cost) &&
                            Math.round(cost * 100) !== Math.round(catalog.cost_price * 100)
                        return (
                            <div key={index} className="space-y-2 rounded-md border p-3">
                                <div className="space-y-1">
                                    <Label>{t('product')}</Label>
                                    <select
                                        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                                        value={line.product_id}
                                        onChange={event => {
                                            const id = event.target.value
                                            const next = productById.get(id)
                                            setLines(current =>
                                                current.map((row, i) =>
                                                    i === index
                                                        ? {
                                                              product_id: id,
                                                              quantity: row.quantity,
                                                              unit_cost: String(next?.cost_price ?? row.unit_cost)
                                                          }
                                                        : row
                                                )
                                            )
                                        }}
                                    >
                                        {products.map(item => (
                                            <option key={item.product.id} value={item.product.id}>
                                                {item.product.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label>{t('quantity')}</Label>
                                        <Input
                                            inputMode="numeric"
                                            value={line.quantity}
                                            onChange={event =>
                                                setLines(current =>
                                                    current.map((row, i) =>
                                                        i === index ? { ...row, quantity: event.target.value } : row
                                                    )
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>{t('unitCost')}</Label>
                                        <Input
                                            inputMode="decimal"
                                            value={line.unit_cost}
                                            onChange={event =>
                                                setLines(current =>
                                                    current.map((row, i) =>
                                                        i === index ? { ...row, unit_cost: event.target.value } : row
                                                    )
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                                {mismatch && catalog && (
                                    <p className="text-xs text-muted-foreground">
                                        {t('costMismatch', {
                                            purchase: money(cost),
                                            catalog: money(catalog.cost_price)
                                        })}
                                    </p>
                                )}
                                {lines.length > 1 && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setLines(current => current.filter((_, i) => i !== index))}
                                    >
                                        {t('removeLine')}
                                    </Button>
                                )}
                            </div>
                        )
                    })}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={lines.length >= 100 || products.length === 0}
                        onClick={() =>
                            setLines(current => [
                                ...current,
                                {
                                    product_id: products[0]?.product.id ?? '',
                                    quantity: '1',
                                    unit_cost: String(products[0]?.product.cost_price ?? 0)
                                }
                            ])
                        }
                    >
                        {t('addLine')}
                    </Button>
                    <div className="space-y-1">
                        <Label htmlFor="po-invoice">{t('invoice')}</Label>
                        <Input
                            id="po-invoice"
                            value={invoice}
                            placeholder={t('invoicePlaceholder')}
                            onChange={event => setInvoice(event.target.value)}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="po-notes">{t('notes')}</Label>
                        <Input id="po-notes" value={notes} onChange={event => setNotes(event.target.value)} />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={fromTill}
                            onChange={event => setFromTill(event.target.checked)}
                        />
                        {t('paidFromTill')}
                    </label>
                    {fromTill ? (
                        sessions.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('noOpenTill')}</p>
                        ) : (
                            <div className="space-y-1">
                                <Label htmlFor="po-till">{t('till')}</Label>
                                <select
                                    id="po-till"
                                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                                    value={selectedSession}
                                    onChange={event => setSessionId(event.target.value)}
                                >
                                    {sessions.map(session => (
                                        <option key={session.id} value={session.id}>
                                            {session.register_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )
                    ) : null}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        {tc('cancel')}
                    </Button>
                    <OfflineDisabledButton type="button" disabled={pending || !selectedSupplier} onClick={onSave}>
                        {pending ? tc('saving') : t('savePurchase')}
                    </OfflineDisabledButton>
                </DialogFooter>
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
    const lowFromUrl = useLowStockQueryFlag()
    const [lowOnly, setLowOnly] = useState(false)
    const [dismissedUrlLow, setDismissedUrlLow] = useState(false)
    const filterLow = lowOnly || (lowFromUrl && !dismissedUrlLow)
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const [adjusting, setAdjusting] = useState<InventoryListItem | null>(null)
    const [thresholdItem, setThresholdItem] = useState<InventoryListItem | null>(null)
    const [buying, setBuying] = useState(false)
    const search = useDebouncedValue(searchQuery)

    const inventory = useApiQuery(
        signal => inventoryApi.list({ page, pageSize, q: search, low: filterLow }, signal),
        JSON.stringify({ page, pageSize, search, filterLow })
    )
    const catalog = useApiQuery(signal => inventoryApi.list({ pageSize: 100 }, signal), 'purchase-catalog')
    const summary = inventory.data?.summary
    const sellablePackages = useApiQuery(
        signal => promotionsApi.list({ pageSize: 100, active: true }, signal),
        'inventory-sellable-packages'
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title={t('title')}
                description={t('subtitle')}
                primaryAction={
                    canAdjust
                        ? {
                              label: t('registerPurchase'),
                              icon: ShoppingCart,
                              onClick: () => setBuying(true)
                          }
                        : undefined
                }
            />

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
                    variant={filterLow ? 'default' : 'outline'}
                    aria-pressed={filterLow}
                    className="w-full lg:w-auto"
                    onClick={() => {
                        if (filterLow) {
                            setLowOnly(false)
                            setDismissedUrlLow(true)
                        } else {
                            setLowOnly(true)
                            setDismissedUrlLow(false)
                        }
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
                                                    <TableCell>
                                                        <span className="inline-flex items-center gap-1">
                                                            {item.low_stock_threshold}
                                                            {canAdjust && (
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-7 w-7"
                                                                    aria-label={t('editThresholdAria', {
                                                                        name: item.product.name
                                                                    })}
                                                                    onClick={() => setThresholdItem(item)}
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </Button>
                                                            )}
                                                        </span>
                                                    </TableCell>
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
                                            <>
                                                <DropdownMenuItem onClick={() => setThresholdItem(item)}>
                                                    <Pencil className="mr-2 h-4 w-4" />
                                                    {t('editThreshold')}
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setAdjusting(item)}>
                                                    <PackagePlus className="mr-2 h-4 w-4" />
                                                    {t('adjustTitle')}
                                                </DropdownMenuItem>
                                            </>
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
                        catalog.reload()
                    }}
                />
            )}
            {thresholdItem && (
                <ThresholdDialog
                    key={thresholdItem.id}
                    item={thresholdItem}
                    onClose={() => setThresholdItem(null)}
                    onSaved={() => {
                        setThresholdItem(null)
                        inventory.reload()
                    }}
                />
            )}
            {buying && (
                <RegisterPurchaseDialog
                    products={catalog.data?.data ?? inventory.data?.data ?? []}
                    onClose={() => setBuying(false)}
                    onSaved={() => {
                        setBuying(false)
                        inventory.reload()
                        catalog.reload()
                    }}
                />
            )}
        </div>
    )
}
