'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Search, Edit, Trash2, FolderTree } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useSession } from '@/components/session-provider'
import { categoriesApi, type CategoryListItem } from '@/lib/api/categories'
import { errorMessage } from '@/lib/api/client'
import { roleAtLeast } from '@/lib/auth/roles'
import { categoryCreateSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const PAGE_SIZE = 25

interface CategoryDialogProps {
    category: CategoryListItem | null
    onClose: () => void
    onSaved: () => void
}

function CategoryDialog({ category, onClose, onSaved }: CategoryDialogProps) {
    const form = useForm({
        resolver: zodResolver(categoryCreateSchema),
        defaultValues: { name: category?.name ?? '', description: category?.description ?? '' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            if (category) {
                await categoriesApi.update(category.id, values)
                toast.success('Category updated successfully')
            } else {
                await categoriesApi.create(values)
                toast.success('Category created successfully')
            }
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to save category'))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{category ? 'Edit Category' : 'Add New Category'}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="name" label="Category Name *" />
                            <TextField name="description" label="Description" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Saving…' : category ? 'Update Category' : 'Create Category'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function CategoriesPage() {
    const { user } = useSession()
    const canManage = roleAtLeast(user.role, 'manager')

    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const search = useDebouncedValue(searchQuery)
    // undefined = closed, null = creating, category = editing
    const [editing, setEditing] = useState<CategoryListItem | null | undefined>(undefined)
    const [toDelete, setToDelete] = useState<CategoryListItem | null>(null)

    const categories = useApiQuery(
        signal => categoriesApi.list({ page, pageSize: PAGE_SIZE, q: search }, signal),
        JSON.stringify({ page, search })
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Categories</h1>
                    <p className="text-muted-foreground">Organize your products with categories</p>
                </div>
                {canManage && (
                    <Button onClick={() => setEditing(null)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Category
                    </Button>
                )}
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search categories..."
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                setPage(1)
                            }}
                            className="pl-10"
                        />
                    </div>
                </div>

                {categories.error ? (
                    <QueryError error={categories.error} onRetry={categories.reload} />
                ) : !categories.data ? (
                    <PageSpinner />
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Category</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Products</TableHead>
                                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {categories.data.data.map(category => (
                                    <TableRow key={category.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                                    <FolderTree className="h-4 w-4 text-emerald-600" />
                                                </div>
                                                <span className="font-medium">{category.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {category.description || '-'}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">{category.product_count} products</Badge>
                                        </TableCell>
                                        {canManage && (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label={`Edit ${category.name}`}
                                                        onClick={() => setEditing(category)}
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        aria-label={`Delete ${category.name}`}
                                                        onClick={() => setToDelete(category)}
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
                        {categories.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">No categories found</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={categories.data.total}
                            onPageChange={setPage}
                        />
                    </>
                )}
            </Card>

            {editing !== undefined && (
                <CategoryDialog
                    key={editing?.id ?? 'new'}
                    category={editing}
                    onClose={() => setEditing(undefined)}
                    onSaved={() => {
                        setEditing(undefined)
                        categories.reload()
                    }}
                />
            )}

            <ConfirmDialog
                open={toDelete !== null}
                onOpenChange={open => !open && setToDelete(null)}
                title="Delete category?"
                description={
                    <>
                        <strong>{toDelete?.name}</strong> will be removed. A category that still has products cannot be
                        deleted.
                    </>
                }
                confirmLabel="Delete"
                onConfirm={async () => {
                    if (!toDelete) return
                    try {
                        await categoriesApi.remove(toDelete.id)
                        toast.success('Category deleted successfully')
                        categories.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, 'Failed to delete category'))
                        throw error
                    }
                }}
            />
        </div>
    )
}
