'use client'

import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Search, Edit, Trash2, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { moneyStep } from '@/lib/money'
import { categoriesApi } from '@/lib/api/categories'
import { ApiError, errorMessage } from '@/lib/api/client'
import { productsApi, type ProductListItem } from '@/lib/api/products'
import { roleAtLeast } from '@/lib/auth/roles'
import { suggestSku } from '@/lib/sku'
import { taxRatePercent } from '@/lib/validation/common'
import { productCreateSchema } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useImageFallback } from '@/hooks/use-image-fallback'
import { usePagination } from '@/hooks/use-pagination'

// The API stores the tax rate as a fraction (0.10); people type a percentage (10).
const productFormSchema = productCreateSchema.extend({
    tax_rate: taxRatePercent,
    cost_price: productCreateSchema.shape.selling_price
})

// A new product starts with the store's default tax rate (Settings), shown as a percentage.
const emptyValues = (defaultTaxPercent: string) => ({
    name: '',
    description: '',
    sku: '',
    barcode: '',
    category_id: '',
    cost_price: '',
    selling_price: '',
    tax_rate: defaultTaxPercent
})

function valuesFor(product: ProductListItem | null, defaultTaxPercent: string) {
    if (!product) return emptyValues(defaultTaxPercent)
    return {
        name: product.name,
        description: product.description ?? '',
        sku: product.sku,
        barcode: product.barcode ?? '',
        category_id: product.category_id ?? '',
        cost_price: String(product.cost_price),
        selling_price: String(product.selling_price),
        tax_rate: String(Math.round(product.tax_rate * 10_000) / 100)
    }
}

interface ProductDialogProps {
    product: ProductListItem | null
    categories: Array<{ value: string; label: string }>
    onClose: () => void
    onSaved: () => void
}

function ProductDialog({ product, categories, onClose, onSaved }: ProductDialogProps) {
    const t = useTranslations('products')
    const tc = useTranslations('common')
    const { settings } = useSession()
    const priceStep = moneyStep(settings.currency)
    const form = useForm<z.input<typeof productFormSchema>, unknown, z.output<typeof productFormSchema>>({
        resolver: zodResolver(productFormSchema),
        defaultValues: valuesFor(product, String(Math.round(settings.tax_rate * 10_000) / 100))
    })
    const submitting = form.formState.isSubmitting

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
                        <div className="grid grid-cols-2 gap-4 py-4 overflow-y-auto px-1">
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
                                <TextField name="sku" label={t('sku')} />
                            ) : (
                                <div className="flex items-end gap-2">
                                    <TextField
                                        name="sku"
                                        label={t('sku')}
                                        description={t('skuHelp')}
                                        className="flex-1"
                                    />
                                    <Button type="button" variant="outline" size="sm" onClick={regenerateSku}>
                                        {t('regenerateSku')}
                                    </Button>
                                </div>
                            )}
                            <TextField name="barcode" label={t('barcode')} />
                            <SelectField
                                name="category_id"
                                label={t('category')}
                                placeholder={t('selectCategory')}
                                noneLabel={t('noCategory')}
                                options={categories}
                            />
                            <TextField
                                name="tax_rate"
                                label={t('taxRate')}
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                            />
                            <TextField
                                name="cost_price"
                                label={t('costPrice')}
                                type="number"
                                step={priceStep}
                                min="0"
                            />
                            <TextField
                                name="selling_price"
                                label={t('sellingPrice')}
                                type="number"
                                step={priceStep}
                                min="0"
                            />
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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">{canManage ? t('subtitleManage') : t('subtitleBrowse')}</p>
                </div>
                {canManage && (
                    <Button onClick={() => setEditing(null)}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('addProduct')}
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

                {products.error ? (
                    <QueryError error={products.error} onRetry={products.reload} />
                ) : !products.data ? (
                    <PageSpinner />
                ) : (
                    <>
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
                                        <TableCell>{product.stock ?? '-'}</TableCell>
                                        <TableCell>
                                            <Badge variant={product.is_active ? 'default' : 'secondary'}>
                                                {product.is_active ? tc('active') : tc('inactive')}
                                            </Badge>
                                        </TableCell>
                                        {canManage && (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
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
            </Card>

            {editing !== undefined && (
                <ProductDialog
                    key={editing?.id ?? 'new'}
                    product={editing}
                    categories={categoryOptions}
                    onClose={() => setEditing(undefined)}
                    onSaved={() => {
                        setEditing(undefined)
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
