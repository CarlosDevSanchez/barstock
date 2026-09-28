'use client'

import { type ComponentProps } from 'react'
import { Trash2, Plus, Minus, ShoppingCart, CreditCard } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMoney, useSession } from '@/components/session-provider'
import { OfflineDisabledButton } from '@/components/pwa/offline-disabled-button'
import { PaymentDialog } from '@/components/pos/payment-dialog'
import { moneyStep } from '@/lib/money'
import type { PromotionListItem } from '@/lib/api/promotions'
import type { ProductListItem } from '@/lib/api/products'
import type { TabListItem } from '@/lib/api/tabs'
import type { PreviewTotals } from '@/lib/cart-preview'
import { cartLineKey, type CartLine } from '@/stores/cart'
import type { PaymentMethod } from '@/types'
import { TabsPanel } from './tabs-panel'

export type CartLineView =
    | { kind: 'product'; item: Extract<CartLine, { kind: 'product' }>; product: ProductListItem | undefined }
    | {
          kind: 'promotion'
          item: Extract<CartLine, { kind: 'promotion' }>
          promotion: PromotionListItem | undefined
      }

interface CustomerOption {
    id: string
    name: string
    phone: string | null
}

export interface CheckoutPayment {
    payment_method: PaymentMethod
    payments?: Array<{ method: PaymentMethod; amount: number }>
}

interface CartSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    lines: CartLineView[]
    lookupSettled: boolean
    problemWith: (line: CartLineView) => string | null
    totals: PreviewTotals
    discount: number
    onDiscountChange: (value: number) => void
    onUpdateQuantity: (key: string, quantity: number) => void
    onRemove: (key: string) => void
    customers: CustomerOption[]
    selectedCustomer: string
    onSelectCustomer: (customerId: string) => void
    blocked: boolean
    /** Offline for longer than settings.offline_max_hours (or the offline catalog snapshot never loaded): too
     * stale to trust an offline sale against. Checkout itself still works offline otherwise (F3) — this is the
     * one case it stays disabled. */
    offlineWindowExpired: boolean
    showPaymentDialog: boolean
    onShowPaymentDialog: (show: boolean) => void
    processing: boolean
    onCheckout: (payment: CheckoutPayment) => void
    openTabs: TabListItem[]
    openTabsLoading: boolean
    onOpenNewTab: () => void
    onSelectTab: (tabId: string) => void
    onAddToTab: () => void
    canAddToTab: boolean
}

/**
 * Checkout works offline too (F3): unlike the other write actions here (`OfflineDisabledButton`, still
 * network-only), it only disables once the till has been offline longer than `settings.offline_max_hours`
 * (`offlineWindowExpired`, computed in `app/(dashboard)/pos/page.tsx`).
 */
function CheckoutButton({
    offlineWindowExpired,
    disabled,
    ...props
}: ComponentProps<typeof Button> & { offlineWindowExpired: boolean }) {
    const t = useTranslations('connection')
    if (!offlineWindowExpired) return <Button disabled={disabled} {...props} />
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {/* A disabled button swallows pointer events, so the tooltip needs this wrapper to still receive them. */}
                <span className="block w-full">
                    <Button disabled {...props} className={`pointer-events-none ${props.className ?? ''}`} />
                </span>
            </TooltipTrigger>
            <TooltipContent>{t('offlineWindowExpired')}</TooltipContent>
        </Tooltip>
    )
}

/** The cart, as a Sheet that opens over the content instead of a fixed side column. Same behaviour as before:
 * customer picker, live-priced lines and a preview total, plus the payment dialog. */
export function CartSheet({
    open,
    onOpenChange,
    lines,
    lookupSettled,
    problemWith,
    totals,
    discount,
    onDiscountChange,
    onUpdateQuantity,
    onRemove,
    customers,
    selectedCustomer,
    onSelectCustomer,
    blocked,
    offlineWindowExpired,
    showPaymentDialog,
    onShowPaymentDialog,
    processing,
    onCheckout,
    openTabs,
    openTabsLoading,
    onOpenNewTab,
    onSelectTab,
    onAddToTab,
    canAddToTab
}: CartSheetProps) {
    const t = useTranslations('pos')
    const tTabs = useTranslations('tabs')
    const tc = useTranslations('common')
    const tConn = useTranslations('connection')
    const money = useMoney()
    const { settings } = useSession()
    const priceStep = moneyStep(settings.currency)

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="right" className="w-full sm:max-w-md p-0">
                    <SheetHeader style={{ paddingTop: 'env(safe-area-inset-top)' }}>
                        <SheetTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5 text-emerald-600" />
                            {t('cart', { count: lines.length })}
                        </SheetTitle>
                    </SheetHeader>
                    <Tabs
                        defaultValue="cart"
                        className="flex-1 flex flex-col overflow-y-auto px-4 gap-4"
                        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
                    >
                        <TabsList className="w-full">
                            <TabsTrigger value="cart">{t('cartTab')}</TabsTrigger>
                            <TabsTrigger value="tabs">
                                {t('tabsTab')} ({openTabs.length})
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="tabs">
                            <TabsPanel
                                tabs={openTabs}
                                loading={openTabsLoading}
                                onOpenNew={onOpenNewTab}
                                onSelect={onSelectTab}
                            />
                        </TabsContent>
                        <TabsContent value="cart" className="flex-1 flex flex-col">
                            <div className="mb-4 space-y-2">
                                <Label className="text-foreground font-semibold">{t('customerOptional')}</Label>
                                <Select
                                    value={selectedCustomer || undefined}
                                    onValueChange={value => onSelectCustomer(value === '__walk_in__' ? '' : value)}
                                >
                                    <SelectTrigger aria-label={t('customer')}>
                                        <SelectValue placeholder={t('walkIn')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__walk_in__">{t('walkIn')}</SelectItem>
                                        {customers.map(customer => (
                                            <SelectItem key={customer.id} value={customer.id}>
                                                {customer.name}
                                                {customer.phone ? ` - ${customer.phone}` : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Separator className="my-3" />

                            <div className="flex-1">
                                {lines.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <ShoppingCart className="h-16 w-16 text-muted-foreground/30 mb-4" />
                                        <p className="text-muted-foreground">{t('cartEmpty')}</p>
                                        <p className="text-sm text-muted-foreground">{t('addProductsHint')}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {lines.map(line => {
                                            const key = cartLineKey(line.item)
                                            const problem = problemWith(line)
                                            const maxStock =
                                                line.kind === 'product'
                                                    ? line.product?.stock
                                                    : line.promotion?.available
                                            const title =
                                                line.kind === 'product'
                                                    ? (line.product?.name ??
                                                      (lookupSettled ? t('unknownProduct') : tc('loading')))
                                                    : (line.promotion?.name ??
                                                      (lookupSettled ? t('unknownPromo') : tc('loading')))
                                            const unitPrice =
                                                line.kind === 'product'
                                                    ? line.product?.selling_price
                                                    : line.promotion?.package_price
                                            return (
                                                <div
                                                    key={key}
                                                    className="flex items-center gap-3 p-3 rounded-xl bg-muted"
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-sm truncate">
                                                            {line.kind === 'promotion' ? (
                                                                <span className="text-amber-700 dark:text-amber-400">
                                                                    {t('promoLine', { name: title })}
                                                                </span>
                                                            ) : (
                                                                title
                                                            )}
                                                        </p>
                                                        {unitPrice !== undefined && (
                                                            <p className="text-sm font-bold text-emerald-600">
                                                                {money(unitPrice)}
                                                            </p>
                                                        )}
                                                        {line.kind === 'promotion' && line.promotion && (
                                                            <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                                                                <p className="font-medium text-muted-foreground/80">
                                                                    {t('promoContains')}
                                                                </p>
                                                                <ul className="space-y-0.5">
                                                                    {line.promotion.items.map(comp => (
                                                                        <li key={comp.id}>
                                                                            {comp.quantity * line.item.quantity}×{' '}
                                                                            {comp.product?.name ?? '—'}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {problem && <p className="text-xs text-red-600">{problem}</p>}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            size="icon"
                                                            variant="outline"
                                                            className="h-7 w-7"
                                                            aria-label={t('decreaseQty')}
                                                            onClick={() =>
                                                                onUpdateQuantity(key, line.item.quantity - 1)
                                                            }
                                                        >
                                                            <Minus className="h-3 w-3" />
                                                        </Button>
                                                        <span className="w-8 text-center font-medium">
                                                            {line.item.quantity}
                                                        </span>
                                                        <Button
                                                            size="icon"
                                                            variant="outline"
                                                            className="h-7 w-7"
                                                            aria-label={t('increaseQty')}
                                                            disabled={
                                                                maxStock !== null &&
                                                                maxStock !== undefined &&
                                                                line.item.quantity >= maxStock
                                                            }
                                                            onClick={() =>
                                                                onUpdateQuantity(key, line.item.quantity + 1)
                                                            }
                                                        >
                                                            <Plus className="h-3 w-3" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                            aria-label={t('removeFromCart')}
                                                            onClick={() => onRemove(key)}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            {lines.length > 0 && (
                                <>
                                    <Separator className="my-4" />
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span>{t('subtotal')}</span>
                                            <span className="font-medium">{money(totals.subtotal)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span>{t('tax')}</span>
                                            <span className="font-medium">{money(totals.tax)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span>{t('discount')}</span>
                                            <Input
                                                type="number"
                                                aria-label={t('discount')}
                                                value={discount}
                                                onChange={e => onDiscountChange(Number(e.target.value) || 0)}
                                                className="w-24 h-8 text-right"
                                                min="0"
                                                step={priceStep}
                                            />
                                        </div>
                                        <Separator />
                                        <div className="flex justify-between text-lg font-bold">
                                            <span>{t('total')}</span>
                                            <span className="text-emerald-600">{money(totals.total)}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{t('estimateHint')}</p>

                                        <CheckoutButton
                                            offlineWindowExpired={offlineWindowExpired}
                                            className="w-full"
                                            size="lg"
                                            onClick={() => onShowPaymentDialog(true)}
                                            disabled={lines.length === 0 || blocked}
                                        >
                                            <CreditCard className="mr-2 h-5 w-5" />
                                            {t('checkout')}
                                        </CheckoutButton>
                                        <OfflineDisabledButton
                                            className="w-full"
                                            variant="outline"
                                            onClick={onAddToTab}
                                            disabled={!canAddToTab}
                                        >
                                            {tTabs('addToTab')}
                                        </OfflineDisabledButton>
                                    </div>
                                </>
                            )}
                        </TabsContent>
                    </Tabs>
                </SheetContent>
            </Sheet>

            <PaymentDialog
                open={showPaymentDialog}
                onOpenChange={onShowPaymentDialog}
                title={t('completePayment')}
                amountDue={totals.total}
                submitLabel={t('completeOrder')}
                processing={processing}
                disabled={offlineWindowExpired}
                disabledReason={offlineWindowExpired ? tConn('offlineWindowExpired') : undefined}
                onSubmit={payments =>
                    onCheckout(
                        payments.length === 2
                            ? { payment_method: payments[0]!.method, payments }
                            : { payment_method: payments[0]!.method }
                    )
                }
            />
        </>
    )
}
