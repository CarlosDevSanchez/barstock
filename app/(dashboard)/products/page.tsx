'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
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
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { categoriesApi } from '@/lib/api/categories'
import { errorMessage } from '@/lib/api/client'
import { productsApi, type ProductListItem } from '@/lib/api/products'
import { roleAtLeast } from '@/lib/auth/roles'
import { taxRatePercent } from '@/lib/validation/common'
import { productCreateSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const PAGE_SIZE = 25

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
    const { settings } = useSession()
    const form = useForm<z.input<typeof productFormSchema>, unknown, z.output<typeof productFormSchema>>({
        resolver: zodResolver(productFormSchema),
        defaultValues: valuesFor(product, String(Math.round(settings.tax_rate * 10_000) / 100))
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            if (product) {
                await productsApi.update(product.id, values)
                toast.success('Product updated successfully')
            } else {
                await productsApi.create(values)
                toast.success('Product created successfully')
            }
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to save product'))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>{product ? 'Edit Product' : 'Add New Product'}</DialogTitle>
                    <DialogDescription>
                        {product ? 'Update product details' : 'Fill in the product information'}
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate className="flex flex-col flex-1 overflow-hidden">
                        <div className="grid grid-cols-2 gap-4 py-4 overflow-y-auto px-1">
                            <TextField name="name" label="Product Name *" className="col-span-2" />
                            <TextField name="description" label="Description" className="col-span-2" />
                            <TextField name="sku" label="SKU *" />
                            <TextField name="barcode" label="Barcode" />
                            <SelectField
                                name="category_id"
                                label="Category"
                                placeholder="Select category"
                                noneLabel="No category"
                                options={categories}
                            />
                            <TextField
                                name="tax_rate"
                                label="Tax Rate (%)"
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                            />
                            <TextField name="cost_price" label="Cost Price *" type="number" step="0.01" min="0" />
                            <TextField name="selling_price" label="Selling Price *" type="number" step="0.01" min="0" />
                        </div>
                        <DialogFooter className="mt-4">
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Saving…' : product ? 'Update Product' : 'Create Product'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function ProductsPage() {
    const { user } = useSession()
    const money = useMoney()
    const canManage = roleAtLeast(user.role, 'manager')

    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const search = useDebouncedValue(searchQuery)
    // undefined = closed, null = creating, product = editing
    const [editing, setEditing] = useState<ProductListItem | null | undefined>(undefined)
    const [toDelete, setToDelete] = useState<ProductListItem | null>(null)

    const products = useApiQuery(
        signal => productsApi.list({ page, pageSize: PAGE_SIZE, q: search }, signal),
        JSON.stringify({ page, search })
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
                    <h1 className="text-3xl font-bold">Products</h1>
                    <p className="text-muted-foreground">
                        {canManage ? 'Manage your product catalog' : 'Browse the product catalog'}
                    </p>
                </div>
                {canManage && (
                    <Button onClick={() => setEditing(null)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Product
                    </Button>
                )}
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name, SKU or barcode..."
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                setPage(1)
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
                                    <TableHead>Product</TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Category</TableHead>
                                    {canManage && <TableHead>Cost</TableHead>}
                                    <TableHead>Price</TableHead>
                                    <TableHead>Stock</TableHead>
                                    <TableHead>Status</TableHead>
                                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {products.data.data.map(product => (
                                    <TableRow key={product.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                                    <Package className="h-4 w-4 text-emerald-600" />
                                                </div>
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
                                                {product.is_active ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </TableCell>
                                        {canManage && (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label={`Edit ${product.name}`}
                                                        onClick={() => setEditing(product)}
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        aria-label={`Delete ${product.name}`}
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
                            <p className="py-8 text-center text-muted-foreground">No products found</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={products.data.total}
                            onPageChange={setPage}
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
                title="Delete product?"
                description={
                    <>
                        <strong>{toDelete?.name}</strong> will no longer appear in the catalog or the POS. Its sales
                        history is kept.
                    </>
                }
                confirmLabel="Delete"
                onConfirm={async () => {
                    if (!toDelete) return
                    try {
                        await productsApi.remove(toDelete.id)
                        toast.success('Product deleted successfully')
                        products.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, 'Failed to delete product'))
                        throw error
                    }
                }}
            />
        </div>
    )
}
