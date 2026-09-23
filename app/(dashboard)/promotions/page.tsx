'use client'

import { useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Gift, Plus, Search, Edit, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SelectField, SwitchField, TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { productsApi, type ProductListItem } from '@/lib/api/products'
import { promotionsApi, type PromotionListItem } from '@/lib/api/promotions'
import { errorMessage } from '@/lib/api/client'
import { roleAtLeast } from '@/lib/auth/roles'
import { moneyStep } from '@/lib/money'
import { packageBottleneckProductIds, packagesAvailable } from '@/lib/promotion-allocate'
import { promotionCreateSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'
import { cn } from '@/lib/utils'

type PromotionFormValues = z.input<typeof promotionCreateSchema>

const emptyValues = (): PromotionFormValues => ({
    name: '',
    package_price: '',
    is_active: true,
    items: [{ product_id: '', quantity: '1' }]
})

function valuesFor(promotion: PromotionListItem | null): PromotionFormValues {
    if (!promotion) return emptyValues()
    return {
        name: promotion.name,
        package_price: String(promotion.package_price),
        is_active: promotion.is_active,
        items: promotion.items.map(item => ({
            product_id: item.product_id,
            quantity: String(item.quantity)
        }))
    }
}

function componentRows(promotion: PromotionListItem) {
    return promotion.items.map(item => ({
        productId: item.product_id,
        quantity: item.quantity,
        stock: item.product?.stock ?? null
    }))
}

interface PromotionDialogProps {
    promotion: PromotionListItem | null
    productOptions: Array<{ value: string; label: string }>
    productById: Map<string, ProductListItem>
    onClose: () => void
    onSaved: () => void
}

function PromotionDialog({ promotion, productOptions, productById, onClose, onSaved }: PromotionDialogProps) {
    const t = useTranslations('promotions')
    const tc = useTranslations('common')
    const { settings } = useSession()
    const priceStep = moneyStep(settings.currency)
    const form = useForm<PromotionFormValues, unknown, z.output<typeof promotionCreateSchema>>({
        resolver: zodResolver(promotionCreateSchema),
        defaultValues: valuesFor(promotion)
    })
    const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' })
    const watchedItems = useWatch({ control: form.control, name: 'items' })
    const submitting = form.formState.isSubmitting

    const estimated = useMemo(() => {
        const components = (watchedItems ?? [])
            .map(row => {
                const qty = Number(row.quantity)
                const product = productById.get(row.product_id)
                if (!row.product_id || !Number.isFinite(qty) || qty < 1) return null
                return { quantity: qty, stock: product?.stock ?? null }
            })
            .filter((c): c is { quantity: number; stock: number | null } => c !== null)
        if (components.length === 0) return null
        return packagesAvailable(components)
    }, [watchedItems, productById])

    const onSubmit = form.handleSubmit(async values => {
        try {
            if (promotion) {
                await promotionsApi.update(promotion.id, values)
                toast.success(t('updated'))
            } else {
                await promotionsApi.create(values)
                toast.success(t('created'))
            }
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('saveFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>{promotion ? t('editTitle') : t('addTitle')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate className="flex flex-col flex-1 overflow-hidden">
                        <div className="space-y-4 py-4 overflow-y-auto px-1">
                            <TextField name="name" label={t('name')} />
                            <TextField
                                name="package_price"
                                label={t('packagePrice')}
                                type="number"
                                step={priceStep}
                                min={0}
                            />
                            {promotion && <SwitchField name="is_active" label={tc('active')} />}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-medium">{t('items')}</p>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => append({ product_id: '', quantity: '1' })}
                                    >
                                        <Plus className="mr-1 h-4 w-4" />
                                        {t('addItem')}
                                    </Button>
                                </div>
                                {fields.map((field, index) => (
                                    <div key={field.id} className="flex items-end gap-2">
                                        <SelectField
                                            name={`items.${index}.product_id`}
                                            label={t('product')}
                                            placeholder={t('selectProduct')}
                                            options={productOptions}
                                            className="flex-1"
                                        />
                                        <TextField
                                            name={`items.${index}.quantity`}
                                            label={t('quantity')}
                                            type="number"
                                            min={1}
                                            step={1}
                                            className="w-24"
                                        />
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="mb-0.5 text-red-600 hover:text-red-700"
                                            aria-label={t('removeItem')}
                                            disabled={fields.length <= 1}
                                            onClick={() => remove(index)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <p className="text-sm rounded-lg bg-muted/60 px-3 py-2">
                                {estimated === null ? (
                                    <span className="text-muted-foreground">{t('estimatedPackagesUnknown')}</span>
                                ) : (
                                    <>
                                        <span className="font-medium">
                                            {t('estimatedPackages', { count: estimated })}
                                        </span>
                                        <span className="block text-xs text-muted-foreground mt-0.5">
                                            {t('estimatedPackagesHint')}
                                        </span>
                                    </>
                                )}
                            </p>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : promotion ? t('updatePromotion') : t('createPromotion')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function PromotionsPage() {
    const { user } = useSession()
    const t = useTranslations('promotions')
    const tc = useTranslations('common')
    const money = useMoney()
    const canManage = roleAtLeast(user.role, 'manager')

    const [searchQuery, setSearchQuery] = useState('')
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const search = useDebouncedValue(searchQuery)
    const [editing, setEditing] = useState<PromotionListItem | null | undefined>(undefined)
    const [toDelete, setToDelete] = useState<PromotionListItem | null>(null)

    const promotions = useApiQuery(
        signal => promotionsApi.list({ page, pageSize, q: search }, signal),
        JSON.stringify({ page, pageSize, search })
    )
    const products = useApiQuery(
        signal => productsApi.list({ pageSize: 100, active: true }, signal),
        'products-for-promotions'
    )

    const productById = useMemo(() => {
        const map = new Map<string, ProductListItem>()
        for (const product of products.data?.data ?? []) map.set(product.id, product)
        return map
    }, [products.data])

    const productOptions = (products.data?.data ?? []).map(product => ({
        value: product.id,
        label:
            product.stock === null
                ? `${product.name} (${t('componentStockUnknown')})`
                : `${product.name} (${t('componentStock', { count: product.stock })})`
    }))

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>
                {canManage && (
                    <Button onClick={() => setEditing(null)}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('addPromotion')}
                    </Button>
                )}
            </div>

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
                </div>

                {promotions.error ? (
                    <QueryError error={promotions.error} onRetry={promotions.reload} />
                ) : !promotions.data ? (
                    <PageSpinner />
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('colPromotion')}</TableHead>
                                    <TableHead>{t('colPrice')}</TableHead>
                                    <TableHead>{t('colItems')}</TableHead>
                                    <TableHead>{t('colPackages')}</TableHead>
                                    <TableHead>{tc('status')}</TableHead>
                                    {canManage && <TableHead className="text-right">{tc('actions')}</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {promotions.data.data.map(promotion => {
                                    const inactiveComponents = promotion.items.filter(
                                        item => !item.product?.is_active || item.product.deleted_at
                                    )
                                    const bottlenecks = new Set(packageBottleneckProductIds(componentRows(promotion)))
                                    return (
                                        <TableRow key={promotion.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                                                        <Gift className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                                                    </div>
                                                    <div>
                                                        <span className="font-medium">{promotion.name}</span>
                                                        {inactiveComponents.length > 0 && (
                                                            <p className="text-xs text-amber-700 dark:text-amber-400">
                                                                {t('unavailableComponents', {
                                                                    count: inactiveComponents.length
                                                                })}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>{money(promotion.package_price)}</TableCell>
                                            <TableCell>
                                                <div className="space-y-0.5 text-sm">
                                                    {promotion.items.map(item => {
                                                        const isBottleneck = bottlenecks.has(item.product_id)
                                                        const stockLabel =
                                                            item.product?.stock === null ||
                                                            item.product?.stock === undefined
                                                                ? t('componentStockUnknown')
                                                                : t('componentStock', {
                                                                      count: item.product.stock
                                                                  })
                                                        return (
                                                            <div
                                                                key={item.id}
                                                                className={cn(
                                                                    'flex flex-wrap items-center gap-1.5',
                                                                    isBottleneck && 'font-medium'
                                                                )}
                                                            >
                                                                <span>
                                                                    {item.quantity}×{' '}
                                                                    {item.product?.name ?? t('unknownProduct')}
                                                                </span>
                                                                <span className="text-xs text-muted-foreground">
                                                                    · {stockLabel}
                                                                </span>
                                                                {isBottleneck && promotion.available !== null && (
                                                                    <Badge
                                                                        variant="outline"
                                                                        className="text-[10px] text-amber-800 border-amber-300"
                                                                    >
                                                                        {t('bottleneck')}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {promotion.available === null ? (
                                                    <span className="text-muted-foreground">
                                                        {t('packagesUnavailable')}
                                                    </span>
                                                ) : (
                                                    <Badge
                                                        variant={promotion.available <= 0 ? 'destructive' : 'secondary'}
                                                    >
                                                        {t('packagesAvailable', { count: promotion.available })}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={promotion.is_active ? 'default' : 'secondary'}>
                                                    {promotion.is_active ? tc('active') : tc('inactive')}
                                                </Badge>
                                            </TableCell>
                                            {canManage && (
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t('editAria', { name: promotion.name })}
                                                            onClick={() => setEditing(promotion)}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="text-red-600 hover:text-red-700"
                                                            aria-label={t('deleteAria', { name: promotion.name })}
                                                            onClick={() => setToDelete(promotion)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                        {promotions.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">{t('noPromotions')}</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={pageSize}
                            total={promotions.data.total}
                            onPageChange={setPage}
                            onPageSizeChange={setPageSize}
                        />
                    </>
                )}
            </Card>

            {editing !== undefined && (
                <PromotionDialog
                    key={editing?.id ?? 'new'}
                    promotion={editing}
                    productOptions={productOptions}
                    productById={productById}
                    onClose={() => setEditing(undefined)}
                    onSaved={() => {
                        setEditing(undefined)
                        promotions.reload()
                    }}
                />
            )}

            <ConfirmDialog
                open={toDelete !== null}
                onOpenChange={open => !open && setToDelete(null)}
                title={t('deleteTitle')}
                description={
                    <>
                        <strong>{toDelete?.name}</strong> {t('deleteBody')}
                    </>
                }
                confirmLabel={tc('delete')}
                onConfirm={async () => {
                    if (!toDelete) return
                    try {
                        await promotionsApi.remove(toDelete.id)
                        toast.success(t('deleted'))
                        promotions.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, t('deleteFailed')))
                        throw error
                    }
                }}
            />
        </div>
    )
}
