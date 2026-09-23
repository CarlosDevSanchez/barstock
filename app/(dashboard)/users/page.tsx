'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { UserPlus, UserCog } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { PageHeader } from '@/components/page-header'
import { FilterBar } from '@/components/filter-bar'
import { ResponsiveList, ListCardRow } from '@/components/responsive-list'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { usersApi, type UserListItem } from '@/lib/api/users'
import { USER_ROLES, type UserRole } from '@/lib/auth/roles'
import { inviteUserSchema } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePagination } from '@/hooks/use-pagination'

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
    const t = useTranslations('users')
    const tc = useTranslations('common')
    const roleOptions = USER_ROLES.map(role => ({ value: role, label: tc(`role.${role}`) }))
    const form = useForm({
        resolver: zodResolver(inviteUserSchema),
        defaultValues: { email: '', full_name: '', role: 'cashier' }
    })
    const submitting = form.formState.isSubmitting

    const onSubmit = form.handleSubmit(async values => {
        try {
            await usersApi.invite(values)
            toast.success(t('inviteSent', { email: values.email }))
            onInvited()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('inviteFailed')))
        }
    })

    return (
        <Dialog open onOpenChange={open => !open && !submitting && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('inviteTitle')}</DialogTitle>
                    <DialogDescription>{t('inviteDescription')}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={onSubmit} noValidate>
                        <div className="space-y-4 py-4">
                            <TextField name="email" label={t('email')} type="email" autoComplete="off" />
                            <TextField name="full_name" label={t('fullName')} />
                            <SelectField
                                name="role"
                                label={t('role')}
                                placeholder={t('rolePlaceholder')}
                                options={roleOptions}
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
                                {tc('cancel')}
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting ? t('sending') : t('sendInvitation')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}

export default function UsersPage() {
    const t = useTranslations('users')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const { user: me } = useSession()
    const [searchQuery, setSearchQuery] = useState('')
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const [inviting, setInviting] = useState(false)
    const [toToggle, setToToggle] = useState<UserListItem | null>(null)
    const search = useDebouncedValue(searchQuery)
    const roleOptions = USER_ROLES.map(role => ({ value: role, label: tc(`role.${role}`) }))

    const users = useApiQuery(
        signal => usersApi.list({ page, pageSize, q: search }, signal),
        JSON.stringify({ page, pageSize, search })
    )

    const changeRole = async (target: UserListItem, role: UserRole) => {
        try {
            await usersApi.update(target.id, { role })
            toast.success(t('roleChanged', { email: target.email, role: tc(`role.${role}`) }))
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('roleChangeFailed')))
        }
        users.reload()
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={t('title')}
                description={t('subtitle')}
                primaryAction={{ label: t('inviteUser'), icon: UserPlus, onClick: () => setInviting(true) }}
            />

            <FilterBar
                search={searchQuery}
                onSearchChange={value => {
                    setSearchQuery(value)
                    reset()
                }}
                searchPlaceholder={t('searchPlaceholder')}
            />

            {users.error ? (
                <QueryError error={users.error} onRetry={users.reload} />
            ) : !users.data ? (
                <PageSpinner />
            ) : (
                <>
                    <ResponsiveList
                        items={users.data.data}
                        keyOf={row => row.id}
                        table={
                            <Card className="rounded-2xl p-6">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('colUser')}</TableHead>
                                            <TableHead>{t('colRole')}</TableHead>
                                            <TableHead>{tc('status')}</TableHead>
                                            <TableHead>{t('colJoined')}</TableHead>
                                            <TableHead className="text-right">{tc('actions')}</TableHead>
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
                                                                        <span className="text-muted-foreground">
                                                                            {' '}
                                                                            {t('you')}
                                                                        </span>
                                                                    )}
                                                                </p>
                                                                {row.full_name && (
                                                                    <p className="text-sm text-muted-foreground">
                                                                        {row.email}
                                                                    </p>
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
                                                            <SelectTrigger
                                                                className="w-32"
                                                                aria-label={t('roleAria', { email: row.email })}
                                                            >
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {roleOptions.map(option => (
                                                                    <SelectItem key={option.value} value={option.value}>
                                                                        {option.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant={row.is_active ? 'default' : 'secondary'}>
                                                            {row.is_active ? tc('active') : t('disabled')}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        {format(new Date(row.created_at), 'MMM dd, yyyy', {
                                                            locale: dateLocale
                                                        })}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {!isMe && (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className={
                                                                    row.is_active
                                                                        ? 'text-red-600 hover:text-red-700'
                                                                        : ''
                                                                }
                                                                onClick={() => setToToggle(row)}
                                                            >
                                                                {row.is_active ? t('disable') : t('enable')}
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </Card>
                        }
                        renderCard={row => {
                            const isMe = row.id === me.id
                            return (
                                <ListCardRow
                                    title={
                                        <>
                                            {row.full_name || row.email}
                                            {isMe && <span className="text-muted-foreground"> {t('you')}</span>}
                                        </>
                                    }
                                    subtitle={row.full_name ? row.email : tc(`role.${row.role}`)}
                                    value={
                                        <Badge variant={row.is_active ? 'default' : 'secondary'}>
                                            {row.is_active ? tc('active') : t('disabled')}
                                        </Badge>
                                    }
                                    menu={
                                        !isMe && (
                                            <>
                                                {roleOptions.map(option => (
                                                    <DropdownMenuItem
                                                        key={option.value}
                                                        disabled={option.value === row.role}
                                                        onClick={() => changeRole(row, option.value)}
                                                    >
                                                        {option.label}
                                                        {option.value === row.role && ` (${tc('active')})`}
                                                    </DropdownMenuItem>
                                                ))}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className={row.is_active ? 'text-red-600' : ''}
                                                    onClick={() => setToToggle(row)}
                                                >
                                                    {row.is_active ? t('disable') : t('enable')}
                                                </DropdownMenuItem>
                                            </>
                                        )
                                    }
                                />
                            )
                        }}
                    />
                    {users.data.data.length === 0 && (
                        <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
                    )}
                    <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={users.data.total}
                        onPageChange={setPage}
                        onPageSizeChange={setPageSize}
                    />
                </>
            )}

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
                title={toToggle?.is_active ? t('disableTitle') : t('enableTitle')}
                description={
                    toToggle?.is_active ? (
                        <>
                            <strong>{toToggle.email}</strong> {t('disableBody')}
                        </>
                    ) : (
                        <>
                            <strong>{toToggle?.email}</strong> {t('enableBody')}
                        </>
                    )
                }
                confirmLabel={toToggle?.is_active ? t('disable') : t('enable')}
                onConfirm={async () => {
                    if (!toToggle) return
                    try {
                        await usersApi.update(toToggle.id, { is_active: !toToggle.is_active })
                        toast.success(toToggle.is_active ? t('userDisabled') : t('userEnabled'))
                        users.reload()
                    } catch (error: unknown) {
                        toast.error(errorMessage(error, t('updateFailed')))
                        throw error
                    }
                }}
            />
        </div>
    )
}
