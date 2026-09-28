'use client'

import { useLocale, useTranslations } from 'next-intl'
import { taxBreakdown } from '@/lib/receipt'
import { groupOrderItemsByPromotion } from '@/lib/order-item-groups'
import { currencyDecimals, formatMoney } from '@/lib/money'
import { sumMoney } from '@/lib/tab-split'
import { moneyLocale } from '@/lib/i18n/config'
import type { OrderDetail } from '@/lib/api/orders'
import type { SettingsWithLogoUrl } from '@/lib/api/settings'

interface ReceiptTicketProps {
    order: OrderDetail
    settings: SettingsWithLogoUrl
    /** Set for a queued-but-not-yet-synced sale (F4): the order/items are a preview (`lib/receipt-preview.ts`),
     * not the real thing yet, so the ticket says so instead of showing a real `order_number`. */
    provisional?: boolean
}

/**
 * Print-only, non-fiscal 80mm POS ticket (`docs/06-roadmap/decisiones-pendientes.md` D21): no CUFE, no QR, no DIAN
 * resolution number, no cash-received/change. Hidden on screen (`hidden print:block`); `app/globals.css` sizes the
 * printed page to 80mm and `app/(dashboard)/orders/[id]/page.tsx` hides the normal on-screen view while printing.
 * Promotion packages are grouped under the promo name; component lines are indented under it.
 */
export function ReceiptTicket({ order, settings, provisional = false }: ReceiptTicketProps) {
    const t = useTranslations('orders')
    const tc = useTranslations('common')
    const locale = useLocale()
    const dtLocale = moneyLocale(locale === 'es' ? 'es' : 'en')
    const money = (amount: number) => formatMoney(amount, settings.currency, dtLocale)
    const dateTime = new Intl.DateTimeFormat(dtLocale, {
        timeZone: settings.timezone,
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(new Date(order.created_at))
    const paymentLabel = (method: string) => {
        if (method === 'cash' || method === 'card' || method === 'ewallet') return tc(`payment.${method}`)
        return method
    }
    const rows = taxBreakdown(order.items)
    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0)
    const groups = groupOrderItemsByPromotion(order.items)

    return (
        <div
            className="hidden print:block font-mono text-[11px] leading-snug text-black"
            style={{ width: '72mm' }}
            data-testid="receipt-ticket"
        >
            <div className="text-center space-y-0.5">
                {settings.store_logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL, printed as-is (thermal = B/W)
                    <img
                        src={settings.store_logo_url}
                        alt=""
                        className="mx-auto mb-1 h-auto object-contain"
                        style={{ maxWidth: '48mm', maxHeight: '24mm' }}
                        data-testid="receipt-logo"
                    />
                )}
                <p className="text-sm font-bold">{settings.store_name}</p>
                {settings.store_tax_id && <p>NIT {settings.store_tax_id}</p>}
                {settings.store_address && <p>{settings.store_address}</p>}
                {settings.store_phone && <p>{settings.store_phone}</p>}
            </div>

            {settings.receipt_template.header && (
                <p className="text-center mt-2 whitespace-pre-wrap">{settings.receipt_template.header}</p>
            )}

            <div className="border-t border-dashed border-black my-2" />

            <div className="text-center space-y-0.5">
                <p className="font-bold">{t('receiptTitle')}</p>
                <p>{t('orderNumberSubtitle', { orderNumber: order.order_number })}</p>
                <p>{dateTime}</p>
            </div>

            {provisional && (
                <>
                    <div className="border-t border-dashed border-black my-2" />
                    <p className="text-center text-sm font-bold" data-testid="receipt-provisional-stamp">
                        {t('receiptProvisionalStamp')}
                    </p>
                </>
            )}

            <div className="border-t border-dashed border-black my-2" />

            <div className="space-y-0.5">
                <p>
                    {t('name')} {order.customer?.name || order.debtor_name || t('walkInCustomer')}
                </p>
                {order.payments.length > 0 && (
                    <p>
                        {t('payment')} {order.payments.map(p => paymentLabel(p.payment_method)).join(', ')}
                    </p>
                )}
                <p>
                    {t('receiptSeller')} {order.created_by_name || t('system')}
                </p>
            </div>

            <div className="border-t border-dashed border-black my-2" />

            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                    <tr className="text-left">
                        <th className="pr-1 font-normal">{t('receiptColQty')}</th>
                        <th className="pr-1 font-normal">{t('receiptColDetail')}</th>
                        <th className="pr-1 font-normal text-right">{t('receiptColTaxPct')}</th>
                        <th className="font-normal text-right">{t('receiptColTotal')}</th>
                    </tr>
                </thead>
                <tbody>
                    {groups.map(group => {
                        if (group.kind === 'product') {
                            const item = group.item
                            return (
                                <tr key={item.id}>
                                    <td className="pr-1 align-top">{item.quantity}</td>
                                    <td className="pr-1 align-top">
                                        {item.product.name}
                                        {item.variant?.name ? ` (${item.variant.name})` : ''}
                                    </td>
                                    <td className="pr-1 align-top text-right">
                                        {item.tax_rate !== null ? `${Math.round(item.tax_rate * 100)}%` : '-'}
                                    </td>
                                    <td className="align-top text-right">{money(item.total)}</td>
                                </tr>
                            )
                        }
                        return (
                            <tr key={`promo-${group.promotionId}`}>
                                <td className="pr-1 align-top">{group.packageQty}</td>
                                <td className="pr-1 align-top" colSpan={2}>
                                    <div className="font-bold">{t('receiptPromo', { name: group.name })}</div>
                                    {group.items.map(item => (
                                        <div key={item.id} className="pl-2">
                                            {item.quantity}× {item.product.name}
                                            {item.variant?.name ? ` (${item.variant.name})` : ''}
                                        </div>
                                    ))}
                                </td>
                                <td className="align-top text-right">{money(group.total)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>

            <div className="border-t border-dashed border-black my-2" />

            <div className="space-y-0.5">
                <div className="flex justify-between">
                    <span>{t('subtotal')}</span>
                    <span>{money(order.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                    <span>{t('tax')}</span>
                    <span>{money(order.tax)}</span>
                </div>
                <div className="flex justify-between">
                    <span>{t('discount')}</span>
                    <span>-{money(order.discount)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                    <span>{t('total')}</span>
                    <span>{money(order.total)}</span>
                </div>
                <p>{t('receiptItemCount', { count: itemCount })}</p>
            </div>

            {rows.length > 0 && (
                <>
                    <div className="border-t border-dashed border-black my-2" />
                    <p className="font-bold">{t('receiptTaxBreakdown')}</p>
                    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                        <thead>
                            <tr className="text-left">
                                <th className="pr-1 font-normal">{t('receiptRate')}</th>
                                <th className="pr-1 font-normal text-right">{t('receiptBase')}</th>
                                <th className="font-normal text-right">{t('tax')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.rate ?? 'null'}>
                                    <td className="pr-1">
                                        {row.rate !== null ? `${Math.round(row.rate * 100)}%` : '-'}
                                    </td>
                                    <td className="pr-1 text-right">{money(row.base)}</td>
                                    <td className="text-right">{money(row.tax)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {order.payments.length > 0 && (
                <div data-testid="receipt-payments">
                    <div className="border-t border-dashed border-black my-2" />
                    <p className="font-bold">{t('receiptPayments')}</p>
                    <div className="space-y-0.5">
                        {order.payments.map(payment => (
                            <div key={payment.id} className="flex justify-between">
                                <span>{paymentLabel(payment.payment_method)}</span>
                                <span>{money(payment.amount)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {order.status === 'refunded' && (
                <>
                    <div className="border-t border-dashed border-black my-2" />
                    <p className="text-center text-sm font-bold">{t('refundedStamp')}</p>
                </>
            )}

            {order.status === 'pending' && (
                <>
                    <div className="border-t border-dashed border-black my-2" />
                    <p className="text-center text-sm font-bold" data-testid="receipt-pending-stamp">
                        {t('receiptPendingStamp', {
                            // E7: sum in minor units so a float remainder never off-by-a-cent the printed balance.
                            balance: money(
                                order.total -
                                    sumMoney(
                                        order.payments.map(payment => payment.amount),
                                        currencyDecimals(settings.currency)
                                    )
                            ),
                            due: (() => {
                                const dueDate = (order as OrderDetail & { due_date?: string | null }).due_date
                                if (!dueDate) return '—'
                                const [, month, day] = dueDate.split('-')
                                return `${day}/${month}`
                            })()
                        })}
                    </p>
                </>
            )}

            {settings.receipt_template.footer && (
                <>
                    <div className="border-t border-dashed border-black my-2" />
                    <p className="text-center whitespace-pre-wrap">{settings.receipt_template.footer}</p>
                </>
            )}
        </div>
    )
}
