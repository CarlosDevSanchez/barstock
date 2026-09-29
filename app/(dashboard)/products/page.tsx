'use client'

import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, Package, RefreshCcw, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SelectField, TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { ProductImageField } from '@/components/product-image-field'
import { MarginSummary } from '@/components/products/margin-summary'
import { StockModeFields } from '@/components/products/stock-mode-fields'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { PageHeader } from '@/components/page-header'
import { FilterBar } from '@/components/filter-bar'
import { ResponsiveList, ListCardRow } from '@/components/responsive-list'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useMoney, useSession } from '@/components/session-provider'
import { moneyStep } from '@/lib/money'
import { categoriesApi } from '@/lib/api/categories'
import { ApiError, errorMessage } from '@/lib/api/client'
import { productsApi, type ProductListItem } from '@/lib/api/products'
import type { StockMode } from '@/lib/stock'
import { roleAtLeast } from '@/lib/auth/roles'
import { suggestSku } from '@/lib/sku'
import { taxRatePercent } from '@/lib/validation/common'
import { normalizeStockMode, productFieldsSchema, refineStockMode } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useImageFallback } from '@/hooks/use-image-fallback'
import { usePagination } from '@/hooks/use-pagination'

// The API stores the tax rate as a fraction (0.10); people type a percentage (10).
const productFormSchema = productFieldsSchema
    .extend({
        tax_rate: taxRatePercent,
        cost_price: productFieldsSchema.shape.selling_price
    })
    .superRefine(refineStockMode)
    .transform(normalizeStockMode)

// A new product starts with the store's default tax rate (Settings), shown as a percentage.
const emptyValues = (defaultTaxPercent: string) => ({
    name: '',
    description: '',
    sku: '',
    barcode: '',
    category_id: '',
    cost_price: '',
    selling_price: '',
    tax_rate: defaultTaxPercent,
    low_stock_threshold: '',
    stock_mode: 'own' as StockMode,
    stock_product_id: '',
    stock_units: ''
})

function valuesFor(product: ProductListItem | null, defaultTaxPercent: string, base: ProductListItem | null) {
    // "Create presentation" on a base product: a new product already linked to it (the manager fills name, units).
    if (!product && base) {
        return { ...emptyValues(defaultTaxPercent), stock_mode: 'linked' as StockMode, stock_product_id: base.id }
    }
    if (!product) return emptyValues(defaultTaxPercent)
    return {
        name: product.name,
        description: product.description ?? '',
        sku: product.sku,
        barcode: product.barcode ?? '',
        category_id: product.category_id ?? '',
        cost_price: String(product.cost_price),
        selling_price: String(product.selling_price),
        tax_rate: String(Math.round(product.tax_rate * 10_000) / 100),
        low_stock_threshold: '',
        stock_mode: product.stock_mode,
        stock_product_id: product.stock_product_id ?? '',
        stock_units: product.stock_mode === 'linked' ? String(product.stock_units) : ''
    }
}

interface ProductDialogProps {
    product: ProductListItem | null
    /** Set when creating a presentation of this (base) product. */
    base: ProductListItem | null
    categories: Array<{ value: string; label: string }>
    onClose: () => void
    onSaved: () => void
}

function ProductDialog({ product, base, categories, onClose, onSaved }: ProductDialogProps) {
    const t = useTranslations('products')
    const tc = useTranslations('common')
    const { settings } = useSession()
    const priceStep = moneyStep(settings.currency)
    const form = useForm<z.input<typeof productFormSchema>, unknown, z.output<typeof productFormSchema>>({
        resolver: zodResolver(productFormSchema),
        defaultValues: valuesFor(product, String(Math.round(settings.tax_rate * 10_000) / 100), base)
    })
    const submitting = form.formState.isSubmitting
    const stockMode = useWatch({ control: form.control, name: 'stock_mode' })

    // The image is uploaded/removed only after the product itself is saved (it needs an id): see onSubmit below.
    const [imageFile, setImageFile] = useState<File | null>(null)
    const [imageRemoved, setImageRemoved] = useState(false)

    // Autofill the SKU from the name while creating a product, but only until the user edits the SKU by
    // hand: `resetField` both sets the value and keeps `isDirty` false (its default `keepDirty: false`),
    // so it keeps following the name; a real edit through the input marks the field dirty and this stops.
    // Never touches the SKU of an existing product.
    const name = useWatch({ control: form.control, name: 'name' })
    useEffect(() => {
        if (product) return
        if (form.getFieldState('sku').isDirty) return
        form.resetField('sku', { defaultValue: suggestSku(name) })
    }, [name, product, form])

    const regenerateSku = () => {
        form.resetField('sku', { defaultValue: suggestSku(form.getValues('name')) })
    }

    const onSubmit = form.handleSubmit(async values => {
        let saved: Tables<'products'>
        try {
            if (product) {
                saved = await productsApi.update(product.id, values)
                toast.success(t('updated'))
            } else {
                saved = await productsApi.create(values)
                toast.success(t('created'))
            }
        } catch (error: unknown) {
            // A duplicate SKU or barcode (Postgres 23505) is a 409 whose details name the field
            // (lib/server/errors.ts). Pin it on that field (with a ready-to-use alternative for the SKU); any
            // other conflict falls through to the generic toast.
            const conflictField = error instanceof ApiError && error.status === 409 ? conflictFieldOf(error) : null
            if (conflictField === 'sku') {
                const suggestion = `${form.getValues('sku')}-2`
                form.setError('sku', { type: 'conflict', message: t('skuConflict', { suggestion }) })
                return
            }
            if (conflictField === 'barcode') {
                form.setError('barcode', { type: 'conflict', message: t('barcodeConflict') })
                return
            }
            toast.error(errorMessage(error, t('saveFailed')))
            return
        }

        // The product is already saved at this point: an image failure is reported but never blocks onSaved().
        try {
            if (imageFile) await productsApi.uploadImage(saved.id, imageFile)
            else if (imageRemoved) await productsApi.deleteImage(saved.id)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('imageSaveFailed')))
        }

        onSaved()
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>{product ? t('editTitle') : t('addTitle')}</DialogTitle>
                    <DialogDescription>{product ? t('editDescription') : t('addDescription')}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate className="flex flex-col flex-1 overflow-hidden">
                        <div className="grid grid-cols-1 gap-4 py-4 overflow-y-auto px-1 sm:grid-cols-2">
                            {settings.storage_configured && (
                                <ProductImageField
                                    label={t('image')}
                                    existingUrl={product?.image_url ?? null}
                                    file={imageFile}
                                    removed={imageRemoved}
                                    onSelect={file => {
                                        setImageFile(file)
                                        setImageRemoved(false)
                                    }}
                                    onRemove={() => {
                                        setImageFile(null)
                                        setImageRemoved(true)
                                    }}
                                    onUndo={() => setImageFile(null)}
                                    disabled={submitting}
                                    addLabel={t('addImage')}
                                    changeLabel={t('changeImage')}
                                    removeLabel={t('removeImage')}
                                    resizeErrorLabel={t('imageResizeFailed')}
                                />
                            )}
                            <TextField name="name" label={t('name')} className="col-span-2" />
                            <TextField name="description" label={t('description')} className="col-span-2" />
                            {product ? (
                                <TextField name="sku" label={t('sku')} className="col-span-2 lg:col-span-1" />
                            ) : (
                                <div className="flex items-end gap-2 col-span-2 lg:col-span-1">
                                    <TextField name="sku" label={t('sku')} className="flex-1" />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        aria-label={t('regenerateSku')}
                                        onClick={regenerateSku}
                                    >
                                        <RefreshCcw className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                            <TextField name="barcode" label={t('barcode')} className="col-span-2 lg:col-span-1" />
                            <SelectField
                                name="category_id"
                                label={t('category')}
                                placeholder={t('selectCategory')}
                                noneLabel={t('noCategory')}
                                options={categories}
                                className="col-span-2 lg:col-span-1"
                            />
                            <TextField
                                name="tax_rate"
                                label={t('taxRate')}
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                className="col-span-2 lg:col-span-1"
                            />
                            <TextField
                                name="cost_price"
                                label={t('costPrice')}
                                type="number"
                                step={priceStep}
                                min="0"
                                className="col-span-2 lg:col-span-1"
                            />
                            <TextField
                                name="selling_price"
                                label={t('sellingPrice')}
                                type="number"
                                step={priceStep}
                                min="0"
                                className="col-span-2 lg:col-span-1"
                            />
                            <MarginSummary />
                            <StockModeFields
                                productId={product?.id ?? null}
                                initialBase={product?.stock_base ?? (base ? { id: base.id, name: base.name } : null)}
                            />
                            {!product && stockMode === 'own' && (
                                <TextField
                                    name="low_stock_threshold"
                                    label={t('lowStockThreshold')}
                                    description={t('lowStockThresholdHint')}
                                    type="number"
                                    step="1"
                                    min="0"
                                />
                            )}
                        </div>
                        <DialogFooter className="mt-4">
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : product ? t('updateProduct') : t('createProduct')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

/** The form field a 409 unique-violation points at (`details.field`, set by lib/server/errors.ts), if any. */
function conflictFieldOf(error: ApiError): string | null {
    const details = error.details
    if (typeof details !== 'object' || details === null || !('field' in details)) return null
    return typeof details.field === 'string' ? details.field : null
}

/** Stock as the catalog should read it: "No tracking", the product's own units, or "N (of Base)" for a presentation. */
function StockCell({ product }: { product: ProductListItem }) {
    const t = useTranslations('products')
    if (product.stock_mode === 'none') return <span className="text-muted-foreground">{t('stockUntracked')}</span>
    if (product.stock_mode === 'linked') {
        return (
            <span>
                {product.stock ?? '-'}{' '}
                <span className="text-muted-foreground">
                    {t('stockOfBase', { units: product.stock_units, base: product.stock_base?.name ?? '' })}
                </span>
            </span>
        )
    }
    return <>{product.stock ?? '-'}</>
}

/** 40px thumbnail for the products table: falls back to the reserve icon when there is no image, or it fails to load. */
function ProductThumbnail({ product }: { product: ProductListItem }) {
    const { showImage, onError } = useImageFallback(product.image_url)

    return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
            {showImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, arbitrary-sized R2 thumbnail
                <img
                    src={product.image_url ?? undefined}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    onError={onError}
                />
            ) : (
                <Package className="h-4 w-4 text-emerald-600" />
            )}
        </div>
    )
}

export default function ProductsPage() {
    const t = useTranslations('products')
    const tc = useTranslations('common')
    const { user } = useSession()
    const money = useMoney()
    const canManage = roleAtLeast(user.role, 'manager')

    const [searchQuery, setSearchQuery] = useState('')
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const search = useDebouncedValue(searchQuery)
    // undefined = closed, null = creating, product = editing
    const [editing, setEditing] = useState<ProductListItem | null | undefined>(undefined)
    // The base product when "Create presentation" opened the dialog (editing is then null).
    const [presentationOf, setPresentationOf] = useState<ProductListItem | null>(null)
    const openCreate = (base: ProductListItem | null) => {
        setPresentationOf(base)
        setEditing(null)
    }
    const closeDialog = () => {
        setEditing(undefined)
        setPresentationOf(null)
    }
    const [toDelete, setToDelete] = useState<ProductListItem | null>(null)

    const products = useApiQuery(
        signal => productsApi.list({ page, pageSize, q: search }, signal),
        JSON.stringify({ page, pageSize, search })
    )
    const categories = useApiQuery(signal => categoriesApi.list({ pageSize: 100 }, signal), 'categories')
    const categoryOptions = (categories.data?.data ?? []).map(category => ({
        value: category.id,
        label: category.name
    }))

    return (
        <div className="space-y-6">
            <PageHeader
                title={t('title')}
                description={canManage ? t('subtitleManage') : t('subtitleBrowse')}
                primaryAction={
                    canManage ? { label: t('addProduct'), icon: Plus, onClick: () => openCreate(null) } : undefined
                }
            />

            <FilterBar
                search={searchQuery}
                onSearchChange={value => {
                    setSearchQuery(value)
                    reset()
                }}
                searchPlaceholder={t('searchPlaceholder')}
            />

            {products.error ? (
                <QueryError error={products.error} onRetry={products.reload} />
            ) : !products.data ? (
                <PageSpinner />
            ) : (
                <>
                    <ResponsiveList
                        items={products.data.data}
                        keyOf={product => product.id}
                        table={
                            <Card className="rounded-2xl p-6">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('colProduct')}</TableHead>
                                            <TableHead>{t('colSku')}</TableHead>
                                            <TableHead>{t('colCategory')}</TableHead>
                                            {canManage && <TableHead>{t('colCost')}</TableHead>}
                                            <TableHead>{t('colPrice')}</TableHead>
                                            <TableHead>{t('colStock')}</TableHead>
                                            <TableHead>{tc('status')}</TableHead>
                                            {canManage && <TableHead className="text-right">{tc('actions')}</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {products.data.data.map(product => (
                                            <TableRow key={product.id}>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <ProductThumbnail product={product} />
                                                        <div>
                                                            <p className="font-medium">{product.name}</p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {product.description}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                                                <TableCell>{product.category?.name || '-'}</TableCell>
                                                {canManage && <TableCell>{money(product.cost_price)}</TableCell>}
                                                <TableCell className="font-semibold text-emerald-600">
                                                    {money(product.selling_price)}
                                                </TableCell>
                                                <TableCell>
                                                    <StockCell product={product} />
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={product.is_active ? 'default' : 'secondary'}>
                                                        {product.is_active ? tc('active') : tc('inactive')}
                                                    </Badge>
                                                </TableCell>
                                                {canManage && (
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-2">
                                                            {product.stock_mode === 'own' && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    aria-label={t('createPresentationAria', {
                                                                        name: product.name
                                                                    })}
                                                                    title={t('createPresentation')}
                                                                    onClick={() => openCreate(product)}
                                                                >
                                                                    <Layers className="h-4 w-4" />
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                aria-label={t('editAria', { name: product.name })}
                                                                onClick={() => setEditing(product)}
                                                            >
                                                                <Edit className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="text-red-600 hover:text-red-700"
                                                                aria-label={t('deleteAria', { name: product.name })}
                                                                onClick={() => setToDelete(product)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Card>
                        }
                        renderCard={product => (
                            <ListCardRow
                                title={product.name}
                                subtitle={product.sku}
                                value={
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="font-semibold text-emerald-600">
                                            {money(product.selling_price)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {t('colStock')}: <StockCell product={product} />
                                        </span>
                                    </div>
                                }
                                menu={
                                    canManage && (
                                        <>
                                            {product.stock_mode === 'own' && (
                                                <DropdownMenuItem onClick={() => openCreate(product)}>
                                                    <Layers className="mr-2 h-4 w-4" />
                                                    {t('createPresentation')}
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={() => setEditing(product)}>
                                                <Edit className="mr-2 h-4 w-4" />
                                                {tc('edit')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-red-600"
                                                onClick={() => setToDelete(product)}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                {tc('delete')}
                                            </DropdownMenuItem>
                                        </>
                                    )
                                }
                            />
                        )}
                    />
                    {products.data.data.length === 0 && (
                        <p className="py-8 text-center text-muted-foreground">{t('noProducts')}</p>
                    )}
                    <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={products.data.total}
                        onPageChange={setPage}
                        onPageSizeChange={setPageSize}
                    />
                </>
            )}

            {editing !== undefined && (
                <ProductDialog
                    key={editing?.id ?? `new-${presentationOf?.id ?? ''}`}
                    product={editing}
                    base={presentationOf}
                    categories={categoryOptions}
                    onClose={closeDialog}
                    onSaved={() => {
                        closeDialog()
                        products.reload()
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
                        await productsApi.remove(toDelete.id)
                        toast.success(t('deleted'))
                        products.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, t('deleteFailed')))
                        throw error
                    }
                }}
            />
        </div>
    )
}
