'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Search, Truck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { errorMessage } from '@/lib/api/client'
import { suppliersApi } from '@/lib/api/suppliers'
import { supplierCreateSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const PAGE_SIZE = 25

function SupplierDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const form = useForm({
        resolver: zodResolver(supplierCreateSchema),
        defaultValues: { name: '', contact_person: '', email: '', phone: '', address: '' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await suppliersApi.create(values)
            toast.success('Supplier added successfully')
            onSaved()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to add supplier'))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add New Supplier</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="name" label="Supplier Name *" />
                            <TextField name="contact_person" label="Contact Person" />
                            <TextField name="email" label="Email" type="email" />
                            <TextField name="phone" label="Phone" />
                            <TextField name="address" label="Address" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Saving…' : 'Add Supplier'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function SuppliersPage() {
    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const [showDialog, setShowDialog] = useState(false)
    const search = useDebouncedValue(searchQuery)

    const suppliers = useApiQuery(
        signal => suppliersApi.list({ page, pageSize: PAGE_SIZE, q: search }, signal),
        JSON.stringify({ page, search })
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Suppliers</h1>
                    <p className="text-muted-foreground">Manage your supplier network</p>
                </div>
                <Button onClick={() => setShowDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Supplier
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="rounded-2xl p-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                            <Truck className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">
                                {search ? 'Matching Suppliers' : 'Total Suppliers'}
                            </p>
                            <p className="text-2xl font-bold">{suppliers.data?.total ?? '-'}</p>
                        </div>
                    </div>
                </Card>
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search suppliers..."
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                setPage(1)
                            }}
                            className="pl-10"
                        />
                    </div>
                </div>

                {suppliers.error ? (
                    <QueryError error={suppliers.error} onRetry={suppliers.reload} />
                ) : !suppliers.data ? (
                    <PageSpinner />
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Contact Person</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Phone</TableHead>
                                    <TableHead>Address</TableHead>
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
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {suppliers.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">No suppliers found</p>
                        )}
                        <Pagination
                            page={page}
                            pageSize={PAGE_SIZE}
                            total={suppliers.data.total}
                            onPageChange={setPage}
                        />
                    </>
                )}
            </Card>

            {showDialog && (
                <SupplierDialog
                    onClose={() => setShowDialog(false)}
                    onSaved={() => {
                        setShowDialog(false)
                        suppliers.reload()
                    }}
                />
            )}
        </div>
    )
}
