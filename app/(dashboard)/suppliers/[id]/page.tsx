'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney, useSession } from '@/components/session-provider'
import { ApiError, errorMessage } from '@/lib/api/client'
import { productsApi } from '@/lib/api/products'
import { purchasesApi } from '@/lib/api/purchases'
import { suppliersApi } from '@/lib/api/suppliers'
import { roleAtLeast } from '@/lib/auth/roles'
import { useApiQuery } from '@/hooks/use-api-query'
import { toast } from 'sonner'

function defaultRange() {
    const to = new Date()
    const from = new Date()
    from.setUTCDate(from.getUTCDate() - 30)
    return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10)
    }
}

export default function SupplierDetailPage() {
    const t = useTranslations('purchases')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dateLocale = locale === 'es' ? es : enUS
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const money = useMoney()
    const { user } = useSession()
    const canVoid = roleAtLeast(user.role, 'admin')
    const initial = useMemo(() => defaultRange(), [])
    const [from, setFrom] = useState(initial.from)
    const [to, setTo] = useState(initial.to)
    const [range, setRange] = useState(initial)
    const [voiding, setVoiding] = useState<{ id: string; po: string } | null>(null)
    const [reason, setReason] = useState('')

    const supplierQuery = useApiQuery(signal => suppliersApi.get(params.id, signal), `supplier:${params.id}`)
    const historyQuery = useApiQuery(
        signal => suppliersApi.history(params.id, range, signal),
        JSON.stringify({ supplierId: params.id, ...range })
    )
    const productsQuery = useApiQuery(
        signal => productsApi.list({ pageSize: 100 }, signal),
        'supplier-history-products'
    )

    const catalogCost = useMemo(() => {
        const map = new Map<string, number>()
        for (const product of productsQuery.data?.data ?? []) {
            map.set(product.id, Number(product.cost_price))
        }
        return map
    }, [productsQuery.data])

    if (supplierQuery.error) {
        if (supplierQuery.error instanceof ApiError && supplierQuery.error.status === 404) {
            return (
                <div className="text-center py-12">
                    <p className="text-muted-foreground">{t('notFound')}</p>
                    <Button onClick={() => router.push('/suppliers')} className="mt-4">
                        {t('backToSuppliers')}
                    </Button>
                </div>
            )
        }
        return <QueryError error={supplierQuery.error} onRetry={supplierQuery.reload} />
    }
    if (!supplierQuery.data) return <PageSpinner />

    const supplier = supplierQuery.data

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('backAria')}
                        onClick={() => router.push('/suppliers')}
                        className="hidden lg:inline-flex"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold lg:text-3xl">{supplier.name}</h1>
                        <p className="text-muted-foreground">{t('historySubtitle')}</p>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                    <Label htmlFor="hist-from">{t('from')}</Label>
                    <Input id="hist-from" type="date" value={from} onChange={event => setFrom(event.target.value)} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="hist-to">{t('to')}</Label>
                    <Input id="hist-to" type="date" value={to} onChange={event => setTo(event.target.value)} />
                </div>
                <Button onClick={() => setRange({ from, to })}>{tc('search')}</Button>
            </div>

            {historyQuery.error ? (
                <QueryError error={historyQuery.error} onRetry={historyQuery.reload} />
            ) : !historyQuery.data ? (
                <PageSpinner />
            ) : (
                <>
                    <Card className="rounded-2xl">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">{t('total')}</CardTitle>
                            <Truck className="h-4 w-4 text-emerald-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{money(historyQuery.data.total)}</div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-2xl p-6">
                        <h2 className="mb-4 text-lg font-semibold">{t('purchases')}</h2>
                        {historyQuery.data.purchases.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('empty')}</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('colPo')}</TableHead>
                                        <TableHead>{t('colInvoice')}</TableHead>
                                        <TableHead>{t('colWhen')}</TableHead>
                                        <TableHead>{t('colAmount')}</TableHead>
                                        {canVoid && <TableHead className="text-right">{tc('actions')}</TableHead>}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {historyQuery.data.purchases.map(row => (
                                        <TableRow key={row.id}>
                                            <TableCell className="font-mono text-sm">{row.po_number}</TableCell>
                                            <TableCell>{row.invoice_number || '—'}</TableCell>
                                            <TableCell>
                                                {format(new Date(row.received_at), 'PP', { locale: dateLocale })}
                                            </TableCell>
                                            <TableCell>{money(row.total_amount)}</TableCell>
                                            {canVoid && (
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-600"
                                                        onClick={() => setVoiding({ id: row.id, po: row.po_number })}
                                                    >
                                                        {t('void')}
                                                    </Button>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </Card>

                    <Card className="rounded-2xl p-6">
                        <h2 className="mb-4 text-lg font-semibold">{t('products')}</h2>
                        {historyQuery.data.products.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('empty')}</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('colProduct')}</TableHead>
                                        <TableHead>{t('colQty')}</TableHead>
                                        <TableHead>{t('colLastCost')}</TableHead>
                                        <TableHead>{t('colAvgCost')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {historyQuery.data.products.map(row => {
                                        const catalog = catalogCost.get(row.product_id)
                                        const mismatch =
                                            catalog !== undefined &&
                                            Math.round(catalog * 100) !== Math.round(row.last_unit_cost * 100)
                                        return (
                                            <TableRow key={row.product_id}>
                                                <TableCell>
                                                    <div className="font-medium">{row.name}</div>
                                                    {mismatch && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {t('costMismatch')}
                                                        </p>
                                                    )}
                                                </TableCell>
                                                <TableCell>{row.quantity}</TableCell>
                                                <TableCell>{money(row.last_unit_cost)}</TableCell>
                                                <TableCell>{money(row.average_unit_cost)}</TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </Card>
                </>
            )}

            <Dialog
                open={voiding !== null}
                onOpenChange={open => {
                    if (!open) {
                        setVoiding(null)
                        setReason('')
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('voidTitle')}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">{voiding?.po}</p>
                    <div className="space-y-1">
                        <Label htmlFor="void-reason">{t('voidReason')}</Label>
                        <Input id="void-reason" value={reason} onChange={event => setReason(event.target.value)} />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="destructive"
                            disabled={reason.trim() === ''}
                            onClick={async () => {
                                if (!voiding || reason.trim() === '') return
                                try {
                                    await purchasesApi.void(voiding.id, reason.trim())
                                    toast.success(t('voided'))
                                    setVoiding(null)
                                    setReason('')
                                    historyQuery.reload()
                                } catch (error) {
                                    toast.error(errorMessage(error))
                                }
                            }}
                        >
                            {t('void')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
