'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Search, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { customersApi } from '@/lib/api/customers'
import { customerCreateSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'

function CustomerDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const t = useTranslations('customers')
    const tc = useTranslations('common')
    const form = useForm({
        resolver: zodResolver(customerCreateSchema),
        defaultValues: { name: '', email: '', phone: '', address: '' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await customersApi.create(values)
            toast.success(t('added'))
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('addFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('addTitle')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="name" label={t('name')} />
                            <TextField name="email" label={t('email')} type="email" />
                            <TextField name="phone" label={t('phone')} />
                            <TextField name="address" label={t('address')} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? tc('saving') : t('addCustomer')}
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
    const [searchQuery, setSearchQuery] = useState('')
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const [showDialog, setShowDialog] = useState(false)
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
                <Button onClick={() => setShowDialog(true)}>
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

            {showDialog && (
                <CustomerDialog
                    onClose={() => setShowDialog(false)}
                    onSaved={() => {
                        setShowDialog(false)
                        customers.reload()
                    }}
                />
            )}
        </div>
    )
}
