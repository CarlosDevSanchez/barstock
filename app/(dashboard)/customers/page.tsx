'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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

const PAGE_SIZE = 25

function CustomerDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const form = useForm({
        resolver: zodResolver(customerCreateSchema),
        defaultValues: { name: '', email: '', phone: '', address: '' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await customersApi.create(values)
            toast.success('Customer added successfully')
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to add customer'))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add New Customer</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="name" label="Name *" />
                            <TextField name="email" label="Email" type="email" />
                            <TextField name="phone" label="Phone" />
                            <TextField name="address" label="Address" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Saving…' : 'Add Customer'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function CustomersPage() {
    const router = useRouter()
    const money = useMoney()
    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const [showDialog, setShowDialog] = useState(false)
    const search = useDebouncedValue(searchQuery)

    const customers = useApiQuery(
        signal => customersApi.list({ page, pageSize: PAGE_SIZE, q: search }, signal),
        JSON.stringify({ page, search })
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Customers</h1>
                    <p className="text-muted-foreground">Manage your customer database</p>
                </div>
                <Button onClick={() => setShowDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Customer
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
                                {search ? 'Matching Customers' : 'Total Customers'}
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
                            placeholder="Search by name, email or phone..."
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                setPage(1)
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
                                    <TableHead>Name</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Loyalty Points</TableHead>
                                    <TableHead>Total Spent</TableHead>
                                    <TableHead>Status</TableHead>
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
                                            <Badge variant="secondary">{customer.loyalty_points} pts</Badge>
                                        </TableCell>
                                        <TableCell className="font-semibold text-emerald-600">
                                            {money(customer.total_spent)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={customer.is_active ? 'default' : 'secondary'}>
                                                {customer.is_active ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {customers.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">No customers found</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={customers.data.total}
                            onPageChange={setPage}
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
