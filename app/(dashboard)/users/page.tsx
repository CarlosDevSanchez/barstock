'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Search, UserPlus, UserCog } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SelectField, TextField } from '@/components/form-fields'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { usersApi, type UserListItem } from '@/lib/api/users'
import { USER_ROLES, type UserRole } from '@/lib/auth/roles'
import { inviteUserSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const PAGE_SIZE = 25
const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier' }
const ROLE_OPTIONS = USER_ROLES.map(role => ({ value: role, label: ROLE_LABELS[role] }))

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
    const form = useForm({
        resolver: zodResolver(inviteUserSchema),
        defaultValues: { email: '', full_name: '', role: 'cashier' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await usersApi.invite(values)
            toast.success(`Invitation sent to ${values.email}`)
            onInvited()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to send the invitation'))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && !submitting && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Invite a user</DialogTitle>
                    <DialogDescription>
                        They receive an email with a link to choose their password. Accounts cannot be created any other
                        way.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="email" label="Email *" type="email" autoComplete="off" />
                            <TextField name="full_name" label="Full name" />
                            <SelectField name="role" label="Role *" placeholder="Role" options={ROLE_OPTIONS} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? 'Sending…' : 'Send invitation'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function UsersPage() {
    const { user: me } = useSession()
    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const [inviting, setInviting] = useState(false)
    const [toToggle, setToToggle] = useState<UserListItem | null>(null)
    const search = useDebouncedValue(searchQuery)

    const users = useApiQuery(
        signal => usersApi.list({ page, pageSize: PAGE_SIZE, q: search }, signal),
        JSON.stringify({ page, search })
    )

    const changeRole = async (target: UserListItem, role: UserRole) => {
        try {
            await usersApi.update(target.id, { role })
            toast.success(`${target.email} is now ${ROLE_LABELS[role]}`)
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to change the role'))
        }
        users.reload()
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Users</h1>
                    <p className="text-muted-foreground">Invite people and manage their access</p>
                </div>
                <Button onClick={() => setInviting(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Invite user
                </Button>
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name or email..."
                            value={searchQuery}
                            onChange={e => {
                                setSearchQuery(e.target.value)
                                setPage(1)
                            }}
                            className="pl-10"
                        />
                    </div>
                </div>

                {users.error ? (
                    <QueryError error={users.error} onRetry={users.reload} />
                ) : !users.data ? (
                    <PageSpinner />
                ) : (
                    <>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>User</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Joined</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.data.data.map(row => {
                                    const isMe = row.id === me.id
                                    return (
                                        <TableRow key={row.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                                        <UserCog className="h-4 w-4 text-emerald-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium">
                                                            {row.full_name || row.email}
                                                            {isMe && (
                                                                <span className="text-muted-foreground"> (you)</span>
                                                            )}
                                                        </p>
                                                        {row.full_name && (
                                                            <p className="text-sm text-muted-foreground">{row.email}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Select
                                                    value={row.role}
                                                    disabled={isMe}
                                                    onValueChange={value => changeRole(row, value as UserRole)}
                                                >
                                                    <SelectTrigger className="w-32" aria-label={`Role of ${row.email}`}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {ROLE_OPTIONS.map(option => (
                                                            <SelectItem key={option.value} value={option.value}>
                                                                {option.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={row.is_active ? 'default' : 'secondary'}>
                                                    {row.is_active ? 'Active' : 'Disabled'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{format(new Date(row.created_at), 'MMM dd, yyyy')}</TableCell>
                                            <TableCell className="text-right">
                                                {!isMe && (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className={
                                                            row.is_active ? 'text-red-600 hover:text-red-700' : ''
                                                        }
                                                        onClick={() => setToToggle(row)}
                                                    >
                                                        {row.is_active ? 'Disable' : 'Enable'}
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                        {users.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">No users found</p>
                        )}
                        <Pagination page={page} pageSize={PAGE_SIZE} total={users.data.total} onPageChange={setPage} />
                    </>
                )}
            </Card>

            {inviting && (
                <InviteDialog
                    onClose={() => setInviting(false)}
                    onInvited={() => {
                        setInviting(false)
                        users.reload()
                    }}
                />
            )}

            <ConfirmDialog
                open={toToggle !== null}
                onOpenChange={open => !open && setToToggle(null)}
                destructive={toToggle?.is_active ?? true}
                title={toToggle?.is_active ? 'Disable this user?' : 'Enable this user?'}
                description={
                    toToggle?.is_active ? (
                        <>
                            <strong>{toToggle.email}</strong> will lose access immediately, even if they are signed in.
                        </>
                    ) : (
                        <>
                            <strong>{toToggle?.email}</strong> will be able to sign in again.
                        </>
                    )
                }
                confirmLabel={toToggle?.is_active ? 'Disable' : 'Enable'}
                onConfirm={async () => {
                    if (!toToggle) return
                    try {
                        await usersApi.update(toToggle.id, { is_active: !toToggle.is_active })
                        toast.success(toToggle.is_active ? 'User disabled' : 'User enabled')
                        users.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, 'Failed to update the user'))
                        throw error
                    }
                }}
            />
        </div>
    )
}
