'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Edit, History, Plus, Trash2, Truck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SwitchField, TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { PageHeader } from '@/components/page-header'
import { FilterBar } from '@/components/filter-bar'
import { ResponsiveList, ListCardRow } from '@/components/responsive-list'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { suppliersApi } from '@/lib/api/suppliers'
import { roleAtLeast } from '@/lib/auth/roles'
import { supplierCreateSchema } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'

type Supplier = Tables<'suppliers'>

const emptyValues = () => ({
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
    is_active: true
})

function valuesFor(supplier: Supplier | null) {
    if (!supplier) return emptyValues()
    return {
        name: supplier.name,
        contact_person: supplier.contact_person ?? '',
        email: supplier.email ?? '',
        phone: supplier.phone ?? '',
        address: supplier.address ?? '',
        notes: supplier.notes ?? '',
        is_active: supplier.is_active
    }
}

interface SupplierDialogProps {
    supplier: Supplier | null
    onClose: () => void
    onSaved: () => void
}

function SupplierDialog({ supplier, onClose, onSaved }: SupplierDialogProps) {
    const t = useTranslations('suppliers')
    const tc = useTranslations('common')
    const form = useForm({
        resolver: zodResolver(supplierCreateSchema),
        defaultValues: valuesFor(supplier)
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            if (supplier) {
                await suppliersApi.update(supplier.id, values)
                toast.success(t('updated'))
            } else {
                await suppliersApi.create(values)
                toast.success(t('added'))
            }
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, supplier ? t('updateFailed') : t('addFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{supplier ? t('editTitle') : t('addTitle')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="name" label={t('name')} />
                            <TextField name="contact_person" label={t('contactPerson')} />
                            <TextField name="email" label={t('email')} type="email" />
                            <TextField name="phone" label={t('phone')} />
                            <TextField name="address" label={t('address')} />
                            {supplier && <SwitchField name="is_active" label={tc('active')} />}
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : supplier ? t('updateSupplier') : t('addSupplier')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function SuppliersPage() {
    const t = useTranslations('suppliers')
    const tc = useTranslations('common')
    const router = useRouter()
    const { user } = useSession()
    const canDelete = roleAtLeast(user.role, 'admin')
    const [searchQuery, setSearchQuery] = useState('')
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    // undefined = closed, null = creating, supplier = editing
    const [editing, setEditing] = useState<Supplier | null | undefined>(undefined)
    const [toDelete, setToDelete] = useState<Supplier | null>(null)
    const search = useDebouncedValue(searchQuery)

    const suppliers = useApiQuery(
        signal => suppliersApi.list({ page, pageSize, q: search }, signal),
        JSON.stringify({ page, pageSize, search })
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title={t('title')}
                description={t('subtitle')}
                primaryAction={{ label: t('addSupplier'), icon: Plus, onClick: () => setEditing(null) }}
            />

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                        <Truck className="h-6 w-6 text-emerald-600" />
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">
                            {search ? t('matchingSuppliers') : t('totalSuppliers')}
                        </p>
                        <p className="text-2xl font-bold">{suppliers.data?.total ?? '-'}</p>
                    </div>
                </div>
            </Card>

            <FilterBar
                search={searchQuery}
                onSearchChange={value => {
                    setSearchQuery(value)
                    reset()
                }}
                searchPlaceholder={t('searchPlaceholder')}
            />

            {suppliers.error ? (
                <QueryError error={suppliers.error} onRetry={suppliers.reload} />
            ) : !suppliers.data ? (
                <PageSpinner />
            ) : (
                <>
                    <ResponsiveList
                        items={suppliers.data.data}
                        keyOf={supplier => supplier.id}
                        table={
                            <Card className="rounded-2xl p-6">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('colName')}</TableHead>
                                            <TableHead>{t('colContact')}</TableHead>
                                            <TableHead>{t('colEmail')}</TableHead>
                                            <TableHead>{t('colPhone')}</TableHead>
                                            <TableHead>{t('colAddress')}</TableHead>
                                            <TableHead className="text-right">{tc('actions')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {suppliers.data.data.map(supplier => (
                                            <TableRow key={supplier.id}>
                                                <TableCell className="font-medium">{supplier.name}</TableCell>
                                                <TableCell>{supplier.contact_person || '-'}</TableCell>
                                                <TableCell>{supplier.email || '-'}</TableCell>
                                                <TableCell>{supplier.phone || '-'}</TableCell>
                                                <TableCell>{supplier.address || '-'}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t('viewHistoryAria', { name: supplier.name })}
                                                            onClick={() => router.push(`/suppliers/${supplier.id}`)}
                                                        >
                                                            <History className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            aria-label={t('editAria', { name: supplier.name })}
                                                            onClick={() => setEditing(supplier)}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        {canDelete && (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="text-red-600 hover:text-red-700"
                                                                aria-label={t('deleteAria', { name: supplier.name })}
                                                                onClick={() => setToDelete(supplier)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Card>
                        }
                        renderCard={supplier => (
                            <ListCardRow
                                title={supplier.name}
                                subtitle={supplier.contact_person || supplier.email || supplier.phone || undefined}
                                href={`/suppliers/${supplier.id}`}
                                menu={
                                    <>
                                        <DropdownMenuItem onClick={() => router.push(`/suppliers/${supplier.id}`)}>
                                            <History className="mr-2 h-4 w-4" />
                                            {t('viewHistory')}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setEditing(supplier)}>
                                            <Edit className="mr-2 h-4 w-4" />
                                            {tc('edit')}
                                        </DropdownMenuItem>
                                        {canDelete && (
                                            <DropdownMenuItem
                                                className="text-red-600"
                                                onClick={() => setToDelete(supplier)}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                {tc('delete')}
                                            </DropdownMenuItem>
                                        )}
                                    </>
                                }
                            />
                        )}
                    />
                    {suppliers.data.data.length === 0 && (
                        <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
                    )}
                    <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={suppliers.data.total}
                        onPageChange={setPage}
                        onPageSizeChange={setPageSize}
                    />
                </>
            )}

            {editing !== undefined && (
                <SupplierDialog
                    key={editing?.id ?? 'new'}
                    supplier={editing}
                    onClose={() => setEditing(undefined)}
                    onSaved={() => {
                        setEditing(undefined)
                        suppliers.reload()
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
                        await suppliersApi.remove(toDelete.id)
                        toast.success(t('deleted'))
                        suppliers.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, t('deleteFailed')))
                        throw error
                    }
                }}
            />
        </div>
    )
}
