'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Edit, Plus, Search, Trash2, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SwitchField, TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { customersApi } from '@/lib/api/customers'
import { roleAtLeast } from '@/lib/auth/roles'
import { customerCreateSchema } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'

type Customer = Tables<'customers'>

const emptyValues = () => ({ name: '', email: '', phone: '', address: '', is_active: true })

function valuesFor(customer: Customer | null) {
    if (!customer) return emptyValues()
    return {
        name: customer.name,
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        address: customer.address ?? '',
        is_active: customer.is_active
    }
}

interface CustomerDialogProps {
    customer: Customer | null
    onClose: () => void
    onSaved: () => void
}

export function CustomerDialog({ customer, onClose, onSaved }: CustomerDialogProps) {
    const t = useTranslations('customers')
    const tc = useTranslations('common')
    const form = useForm({
        resolver: zodResolver(customerCreateSchema),
        defaultValues: valuesFor(customer)
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            if (customer) {
                await customersApi.update(customer.id, values)
                toast.success(t('updated'))
            } else {
                await customersApi.create(values)
                toast.success(t('added'))
            }
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, customer ? t('updateFailed') : t('addFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{customer ? t('editTitle') : t('addTitle')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="name" label={t('name')} />
                            <TextField name="email" label={t('email')} type="email" />
                            <TextField name="phone" label={t('phone')} />
                            <TextField name="address" label={t('address')} />
                            {customer && <SwitchField name="is_active" label={tc('active')} />}
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : customer ? t('updateCustomer') : t('addCustomer')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function CustomersPage() {
    const t = useTranslations('customers')
    const tc = useTranslations('common')
    const router = useRouter()
    const money = useMoney()
    const { user } = useSession()
    const canDelete = roleAtLeast(user.role, 'admin')
    const [searchQuery, setSearchQuery] = useState('')
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    // undefined = closed, null = creating, customer = editing
    const [editing, setEditing] = useState<Customer | null | undefined>(undefined)
    const [toDelete, setToDelete] = useState<Customer | null>(null)
    const search = useDebouncedValue(searchQuery)

    const customers = useApiQuery(
        signal => customersApi.list({ page, pageSize, q: search }, signal),
        JSON.stringify({ page, pageSize, search })
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>
                <Button onClick={() => setEditing(null)}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t('addCustomer')}
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="rounded-2xl p-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                            <Users className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">
                                {search ? t('matchingCustomers') : t('totalCustomers')}
                            </p>
                            <p className="text-2xl font-bold">{customers.data?.total ?? '-'}</p>
                        </div>
                    </div>
                </Card>
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

                {customers.error ? (
                    <QueryError error={customers.error} onRetry={customers.reload} />
                ) : !customers.data ? (
                    <PageSpinner />
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('colName')}</TableHead>
                                    <TableHead>{t('colEmail')}</TableHead>
                                    <TableHead>{t('colPhone')}</TableHead>
                                    <TableHead>{t('colLoyalty')}</TableHead>
                                    <TableHead>{t('colTotalSpent')}</TableHead>
                                    <TableHead>{t('colStatus')}</TableHead>
                                    <TableHead className="text-right">{tc('actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {customers.data.data.map(customer => (
                                    <TableRow
                                        key={customer.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => router.push(`/customers/${customer.id}`)}
                                    >
                                        <TableCell className="font-medium">{customer.name}</TableCell>
                                        <TableCell>{customer.email || '-'}</TableCell>
                                        <TableCell>{customer.phone || '-'}</TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">
                                                {t('points', { count: customer.loyalty_points })}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-semibold text-emerald-600">
                                            {money(customer.total_spent)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={customer.is_active ? 'default' : 'secondary'}>
                                                {customer.is_active ? tc('active') : tc('inactive')}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    aria-label={t('editAria', { name: customer.name })}
                                                    onClick={e => {
                                                        e.stopPropagation()
                                                        setEditing(customer)
                                                    }}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                {canDelete && (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        aria-label={t('deleteAria', { name: customer.name })}
                                                        onClick={e => {
                                                            e.stopPropagation()
                                                            setToDelete(customer)
                                                        }}
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
                        {customers.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={pageSize}
                            total={customers.data.total}
                            onPageChange={setPage}
                            onPageSizeChange={setPageSize}
                        />
                    </>
                )}
            </Card>

            {editing !== undefined && (
                <CustomerDialog
                    key={editing?.id ?? 'new'}
                    customer={editing}
                    onClose={() => setEditing(undefined)}
                    onSaved={() => {
                        setEditing(undefined)
                        customers.reload()
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
                        await customersApi.remove(toDelete.id)
                        toast.success(t('deleted'))
                        customers.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, t('deleteFailed')))
                        throw error
                    }
                }}
            />
        </div>
    )
}
