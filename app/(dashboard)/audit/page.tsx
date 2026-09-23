'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Eye, SlidersHorizontal } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Pagination } from '@/components/pagination'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { PageHeader } from '@/components/page-header'
import { ResponsiveList, ListCardRow } from '@/components/responsive-list'
import { useSession } from '@/components/session-provider'
import { auditApi, type AuditRow } from '@/lib/api/audit'
import { usersApi } from '@/lib/api/users'
import { AUDIT_ACTIONS } from '@/lib/validation/resources'
import { useApiQuery } from '@/hooks/use-api-query'
import { usePagination } from '@/hooks/use-pagination'

const ALL = 'all'
const ENTITIES = [
    'products',
    'categories',
    'promotions',
    'promotion_items',
    'inventory',
    'orders',
    'customers',
    'suppliers',
    'settings',
    'profiles',
    'tabs',
    'tab_items',
    'tab_payments',
    'auth'
] as const

const actionColor = (action: string) => {
    switch (action) {
        case 'delete':
            return 'destructive'
        case 'insert':
        case 'login':
        case 'invite':
            return 'default'
        case 'login_failed':
            return 'destructive'
        default:
            return 'secondary'
    }
}

export default function AuditPage() {
    const t = useTranslations('audit')
    const tc = useTranslations('common')
    const locale = useLocale()
    const { settings } = useSession()
    const [actorId, setActorId] = useState(ALL)
    const [action, setAction] = useState(ALL)
    const [entity, setEntity] = useState(ALL)
    const [range, setRange] = useState({ from: '', to: '' })
    const [selected, setSelected] = useState<AuditRow | null>(null)
    const [filtersOpen, setFiltersOpen] = useState(false)
    const { page, pageSize, setPage, setPageSize, reset } = usePagination()
    const activeFilterCount = [
        actorId !== ALL,
        action !== ALL,
        entity !== ALL,
        range.from !== '',
        range.to !== ''
    ].filter(Boolean).length

    const users = useApiQuery(signal => usersApi.list({ page: 1, pageSize: 100 }, signal), 'audit-users')

    const audit = useApiQuery(
        signal =>
            auditApi.list(
                {
                    page,
                    pageSize,
                    actor_id: actorId === ALL ? undefined : actorId,
                    action: action === ALL ? undefined : action,
                    entity: entity === ALL ? undefined : entity,
                    from: range.from || undefined,
                    to: range.to || undefined
                },
                signal
            ),
        JSON.stringify({ page, pageSize, actorId, action, entity, range })
    )

    const formatDate = (value: string) =>
        new Intl.DateTimeFormat(locale === 'es' ? 'es' : 'en-US', {
            timeZone: settings.timezone,
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(value))

    const userLabel = (row: AuditRow) => row.actor_email ?? t('system')

    const filterControls = (
        <div className="flex flex-wrap items-end gap-4">
            <div className="w-full space-y-1 lg:w-52">
                <Label>{t('filterUser')}</Label>
                <Select
                    value={actorId}
                    onValueChange={value => {
                        setActorId(value)
                        reset()
                    }}
                >
                    <SelectTrigger className="w-full" aria-label={t('filterUser')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t('allUsers')}</SelectItem>
                        {users.data?.data.map(user => (
                            <SelectItem key={user.id} value={user.id}>
                                {user.full_name ?? user.email}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="w-full space-y-1 lg:w-44">
                <Label>{t('filterAction')}</Label>
                <Select
                    value={action}
                    onValueChange={value => {
                        setAction(value)
                        reset()
                    }}
                >
                    <SelectTrigger className="w-full" aria-label={t('filterAction')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t('allActions')}</SelectItem>
                        {AUDIT_ACTIONS.map(value => (
                            <SelectItem key={value} value={value}>
                                {t(`action.${value}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="w-full space-y-1 lg:w-44">
                <Label>{t('filterEntity')}</Label>
                <Select
                    value={entity}
                    onValueChange={value => {
                        setEntity(value)
                        reset()
                    }}
                >
                    <SelectTrigger className="w-full" aria-label={t('filterEntity')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t('allEntities')}</SelectItem>
                        {ENTITIES.map(value => (
                            <SelectItem key={value} value={value}>
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="w-full space-y-1 lg:w-auto">
                <Label htmlFor="audit-from">{t('from')}</Label>
                <Input
                    id="audit-from"
                    type="date"
                    value={range.from}
                    max={range.to || undefined}
                    onChange={e => {
                        setRange(current => ({ ...current, from: e.target.value }))
                        reset()
                    }}
                />
            </div>
            <div className="w-full space-y-1 lg:w-auto">
                <Label htmlFor="audit-to">{t('to')}</Label>
                <Input
                    id="audit-to"
                    type="date"
                    value={range.to}
                    min={range.from || undefined}
                    onChange={e => {
                        setRange(current => ({ ...current, to: e.target.value }))
                        reset()
                    }}
                />
            </div>
        </div>
    )

    return (
        <div className="space-y-6">
            <PageHeader title={t('title')} description={t('subtitle')} />

            <div className="hidden lg:block">{filterControls}</div>
            <Button variant="outline" className="relative lg:hidden" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal className="mr-2 size-4" />
                {tc('filters')}
                {activeFilterCount > 0 && (
                    <Badge className="ml-2 size-5 rounded-full p-0 justify-center">{activeFilterCount}</Badge>
                )}
            </Button>
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
                    <SheetHeader>
                        <SheetTitle>{tc('filters')}</SheetTitle>
                    </SheetHeader>
                    <div className="px-4 pb-6">{filterControls}</div>
                </SheetContent>
            </Sheet>

            {audit.error ? (
                <QueryError error={audit.error} onRetry={audit.reload} />
            ) : !audit.data ? (
                <PageSpinner />
            ) : (
                <>
                    <ResponsiveList
                        items={audit.data.data}
                        keyOf={row => row.id}
                        table={
                            <Card className="rounded-2xl p-6">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>{t('colDate')}</TableHead>
                                            <TableHead>{t('colUser')}</TableHead>
                                            <TableHead>{t('colRole')}</TableHead>
                                            <TableHead>{t('colAction')}</TableHead>
                                            <TableHead>{t('colEntity')}</TableHead>
                                            <TableHead className="text-right">{tc('actions')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {audit.data.data.map(row => (
                                            <TableRow key={row.id}>
                                                <TableCell>{formatDate(row.occurred_at)}</TableCell>
                                                <TableCell>{userLabel(row)}</TableCell>
                                                <TableCell>
                                                    {row.actor_role ? tc(`role.${row.actor_role}`) : '—'}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={actionColor(row.action)}>
                                                        {t(`action.${row.action}`)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-mono text-sm">{row.entity}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        aria-label={t('viewAria')}
                                                        disabled={!row.changes}
                                                        onClick={() => setSelected(row)}
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Card>
                        }
                        renderCard={row => (
                            <ListCardRow
                                onClick={row.changes ? () => setSelected(row) : undefined}
                                title={
                                    <span className="flex items-center gap-2">
                                        <Badge variant={actionColor(row.action)}>{t(`action.${row.action}`)}</Badge>
                                        <span className="font-mono text-sm text-muted-foreground">{row.entity}</span>
                                    </span>
                                }
                                subtitle={`${userLabel(row)} · ${formatDate(row.occurred_at)}`}
                            />
                        )}
                    />
                    {audit.data.data.length === 0 && (
                        <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
                    )}
                    <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={audit.data.total}
                        onPageChange={setPage}
                        onPageSizeChange={setPageSize}
                    />
                </>
            )}

            <Dialog open={selected !== null} onOpenChange={open => !open && setSelected(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('changesTitle')}</DialogTitle>
                    </DialogHeader>
                    <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs">
                        {selected ? JSON.stringify(selected.changes, null, 2) : ''}
                    </pre>
                </DialogContent>
            </Dialog>
        </div>
    )
}
