'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyDecimals } from '@/lib/money'
import type { Paginated } from '@/lib/api/types'
import { categoriesApi } from '@/lib/api/categories'
import { errorMessage } from '@/lib/api/client'
import { customersApi } from '@/lib/api/customers'
import { productsApi, type ProductListItem } from '@/lib/api/products'
import { promotionsApi, type PromotionListItem } from '@/lib/api/promotions'
import { salesApi, type OrderDetail } from '@/lib/api/orders'
import { tabsApi } from '@/lib/api/tabs'
import { enqueueSale, type OutboxSaleItem } from '@/lib/offline/outbox'
import { previewTotals, type PreviewLine } from '@/lib/cart-preview'
import { allocatePackagePrice } from '@/lib/promotion-allocate'
import { buildProvisionalOrder } from '@/lib/receipt-preview'
import { useMoney, useSession } from '@/components/session-provider'
import type { PaymentMethod } from '@/types'
import { useCartStore } from '@/stores/cart'
import { type ApiQuery, useApiQuery } from '@/hooks/use-api-query'
import { type InfiniteApiList, useInfiniteApiList } from '@/hooks/use-infinite-api-list'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { usePosSnapshot } from '@/hooks/use-pos-snapshot'
import { AddToTabDialog } from '@/components/pos/add-to-tab-dialog'
import { CartBubble } from '@/components/pos/cart-bubble'
import { CartSheet, type CartLineView } from '@/components/pos/cart-sheet'
import { OpenTabDialog } from '@/components/pos/open-tab-dialog'
import { ProductGrid } from '@/components/pos/product-grid'
import { PromotionsStrip, promoPendingKey } from '@/components/pos/promotions-strip'
import { ReceiptTicket } from '@/components/orders/receipt-ticket'
import { TabDetailSheet } from '@/components/pos/tab-detail-sheet'
import { TopProducts } from '@/components/pos/top-products'

const PAGE_SIZE = 30
const ALL = 'all'

function matchesOfflineProduct(product: ProductListItem, category: string, search: string): boolean {
    if (category !== ALL && product.category_id !== category) return false
    if (!search) return true
    const needle = search.toLowerCase()
    return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        (product.barcode ?? '').toLowerCase().includes(needle)
    )
}

/** Wraps an already-loaded array (from the offline snapshot) as the shape `useApiQuery` callers expect. */
function snapshotQuery<T>(rows: T[], reload: () => void): ApiQuery<Paginated<T>> {
    return {
        data: { data: rows, page: 1, pageSize: Math.max(rows.length, 1), total: rows.length },
        loading: false,
        error: undefined,
        stale: true,
        reload
    }
}

export default function POSPage() {
    const t = useTranslations('pos')
    const tTabs = useTranslations('tabs')
    const router = useRouter()
    const { user, settings } = useSession()
    const money = useMoney()
    const decimals = currencyDecimals(settings.currency)
    const online = useOnlineStatus()
    const snapshot = usePosSnapshot()
    // No known-good server contact within the window (F2's settings.offline_max_hours), or none yet ever: too
    // stale to trust an offline sale against. See F3, docs/06-roadmap/offline-y-sincronizacion.md. Re-evaluated on
    // an interval (not on every render, since reading the clock is impure) so it flips on its own while the cart
    // is left open offline, without needing a user action.
    const [offlineWindowExpired, setOfflineWindowExpired] = useState(false)
    const generatedAt = snapshot.data?.generated_at
    useEffect(() => {
        const evaluate = () => {
            setOfflineWindowExpired(
                !online &&
                    (!generatedAt ||
                        Date.now() - new Date(generatedAt).getTime() > settings.offline_max_hours * 3_600_000)
            )
        }
        evaluate()
        const interval = setInterval(evaluate, 60_000)
        return () => clearInterval(interval)
    }, [online, generatedAt, settings.offline_max_hours])

    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState(ALL)
    const [selectedCustomer, setSelectedCustomer] = useState('')
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
    const [showCart, setShowCart] = useState(false)
    const [showPaymentDialog, setShowPaymentDialog] = useState(false)
    const [processing, setProcessing] = useState(false)
    const [topReloadSignal, setTopReloadSignal] = useState(0)
    const [showOpenTabDialog, setShowOpenTabDialog] = useState(false)
    const [showAddToTabDialog, setShowAddToTabDialog] = useState(false)
    const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
    // One pending tile at a time (product, Top 5, or promo): qty is local draft until Confirm.
    const [pendingId, setPendingId] = useState<string | null>(null)
    const [pendingQty, setPendingQty] = useState(1)
    // One key per checkout attempt: pressing "Cobrar" again before a reply arrives reuses it, so a retry cannot
    // charge twice. A fresh attempt (dialog reopened) gets a fresh key.
    const [checkoutKey, setCheckoutKey] = useState<string | null>(null)
    // Last offline sale queued (F4): printable via the hidden ticket below, marked PROVISIONAL until it syncs.
    const [provisionalReceipt, setProvisionalReceipt] = useState<OrderDetail | null>(null)
    const search = useDebouncedValue(searchQuery)

    const items = useCartStore(state => state.items)
    const discount = useCartStore(state => state.discount)
    const { addItem, addPromotion, removeItem, updateQuantity, setGlobalDiscount, clearCart } = useCartStore()

    const qtyInCartProduct = (productId: string) =>
        items.find(item => item.kind === 'product' && item.productId === productId)?.quantity ?? 0
    const qtyInCartPromo = (promotionId: string) =>
        items.find(item => item.kind === 'promotion' && item.promotionId === promotionId)?.quantity ?? 0

    const clearPending = () => {
        setPendingId(null)
        setPendingQty(1)
    }

    const handleSelectProduct = (productId: string) => {
        setPendingId(productId)
        setPendingQty(1)
    }

    const handleSelectPromotion = (promotionId: string) => {
        setPendingId(promoPendingKey(promotionId))
        setPendingQty(1)
    }

    const handleChangePendingQty = (qty: number) => {
        if (qty <= 0) {
            clearPending()
            return
        }
        setPendingQty(qty)
    }

    const handleConfirmPending = () => {
        if (!pendingId || pendingQty < 1) return
        if (pendingId.startsWith('promo:')) {
            addPromotion(pendingId.slice('promo:'.length), pendingQty)
        } else {
            addItem(pendingId, pendingQty)
        }
        clearPending()
    }

    // Every query below reads live over the network while online, and falls back to the offline snapshot (F1,
    // docs/06-roadmap/offline-y-sincronizacion.md) while not: search and category filtering happen in memory
    // against whatever snapshot was last persisted (possibly stale, possibly none yet). Checkout itself queues the
    // sale instead of calling the server directly while offline (F3) — see handleCheckout below.
    const liveCatalog = useInfiniteApiList<ProductListItem>(
        (page, pageSize, signal) =>
            productsApi.list(
                {
                    page,
                    pageSize,
                    q: search,
                    category_id: selectedCategory === ALL ? undefined : selectedCategory,
                    active: true
                },
                signal
            ),
        JSON.stringify({ search, selectedCategory }),
        PAGE_SIZE
    )
    const offlineCatalogItems = useMemo(
        () =>
            (snapshot.data?.products ?? []).filter(product => matchesOfflineProduct(product, selectedCategory, search)),
        [snapshot.data, selectedCategory, search]
    )
    const catalog: InfiniteApiList<ProductListItem> = online
        ? liveCatalog
        : {
              items: offlineCatalogItems,
              total: offlineCatalogItems.length,
              loading: false,
              loadingMore: false,
              error: undefined,
              hasMore: false,
              loadMore: () => {},
              reload: snapshot.refresh
          }

    const liveCategories = useApiQuery(signal => categoriesApi.list({ pageSize: 100 }, signal), 'categories')
    const categoryOptions = online ? (liveCategories.data?.data ?? []) : (snapshot.data?.categories ?? [])
    const liveCustomers = useApiQuery(signal => customersApi.list({ pageSize: 100 }, signal), 'customers')
    const openTabs = useApiQuery(signal => tabsApi.list({ status: 'open', pageSize: 100 }, signal), 'open-tabs')
    const liveActivePromos = useApiQuery(
        signal => promotionsApi.list({ pageSize: 100, active: true }, signal),
        'pos-promotions'
    )
    const activePromos = online ? liveActivePromos : snapshotQuery(snapshot.data?.promotions ?? [], snapshot.refresh)

    const productIds = items
        .filter(item => item.kind === 'product')
        .map(item => item.productId)
        .sort()
        .join(',')
    const promoIds = items
        .filter(item => item.kind === 'promotion')
        .map(item => item.promotionId)
        .sort()
        .join(',')
    const liveCartProducts = useApiQuery(
        signal => (productIds ? productsApi.list({ ids: productIds, pageSize: 100 }, signal) : Promise.resolve(null)),
        `cart-products:${productIds}`
    )
    const liveCartPromos = useApiQuery(
        signal =>
            promoIds
                ? promotionsApi.list({ ids: promoIds, pageSize: 100, active: true }, signal)
                : Promise.resolve(null),
        `cart-promos:${promoIds}`
    )
    const cartIds = new Set(productIds ? productIds.split(',') : [])
    const cartPromoIds = new Set(promoIds ? promoIds.split(',') : [])
    const cartProducts = online
        ? liveCartProducts
        : snapshotQuery(
              (snapshot.data?.products ?? []).filter(product => cartIds.has(product.id)),
              snapshot.refresh
          )
    const cartPromos = online
        ? liveCartPromos
        : snapshotQuery(
              (snapshot.data?.promotions ?? []).filter(promotion => cartPromoIds.has(promotion.id)),
              snapshot.refresh
          )

    const products = useMemo(() => {
        const map = new Map<string, ProductListItem>()
        for (const product of catalog.items) map.set(product.id, product)
        for (const product of cartProducts.data?.data ?? []) map.set(product.id, product)
        return map
    }, [catalog.items, cartProducts.data])

    const promotions = useMemo(() => {
        const map = new Map<string, PromotionListItem>()
        for (const promo of activePromos.data?.data ?? []) map.set(promo.id, promo)
        for (const promo of cartPromos.data?.data ?? []) map.set(promo.id, promo)
        return map
    }, [activePromos.data, cartPromos.data])

    const lines: CartLineView[] = items.map(item =>
        item.kind === 'product'
            ? { kind: 'product', item, product: products.get(item.productId) }
            : { kind: 'promotion', item, promotion: promotions.get(item.promotionId) }
    )

    const lookupSettled =
        (productIds === '' || (cartProducts.data !== undefined && !cartProducts.loading)) &&
        (promoIds === '' || (cartPromos.data !== undefined && !cartPromos.loading))

    const problemWith = (line: CartLineView) => {
        if (line.kind === 'product') {
            const { item, product } = line
            if (!product) return lookupSettled ? t('noLongerAvailable') : null
            if (!product.is_active || product.stock === null) return t('noLongerAvailable')
            if (item.quantity > product.stock) return t('onlyInStock', { count: product.stock })
            return null
        }
        const { item, promotion } = line
        if (!promotion) return lookupSettled ? t('noLongerAvailable') : null
        if (!promotion.is_active || promotion.available === null) return t('noLongerAvailable')
        if (item.quantity > promotion.available) return t('onlyInStock', { count: promotion.available })
        return null
    }

    const blocked = lines.some(line => {
        if (line.kind === 'product') return !line.product || problemWith(line) !== null
        return !line.promotion || problemWith(line) !== null
    })

    const previewLines: PreviewLine[] = []
    for (const line of lines) {
        if (line.kind === 'product') {
            if (!line.product) continue
            previewLines.push({
                unitPrice: line.product.selling_price,
                taxRate: line.product.tax_rate,
                quantity: line.item.quantity,
                discount: line.item.discount
            })
            continue
        }
        if (!line.promotion) continue
        const components = line.promotion.items
            .filter(c => c.product)
            .map(c => ({
                productId: c.product_id,
                quantity: c.quantity,
                sellingPrice: c.product!.selling_price,
                taxRate: c.product!.tax_rate
            }))
        for (const allocated of allocatePackagePrice(
            line.promotion.package_price,
            line.item.quantity,
            components,
            decimals
        )) {
            previewLines.push({
                unitPrice: allocated.unitPrice,
                taxRate: allocated.taxRate,
                quantity: allocated.quantity,
                discount: allocated.discount
            })
        }
    }
    const totals = previewTotals(previewLines, discount, decimals)
    const activeCustomers = online
        ? (liveCustomers.data?.data ?? []).filter(customer => customer.is_active)
        : (snapshot.data?.customers ?? [])
    const canAddToTab = lines.length > 0 && !blocked

    const buildSaleItems = (): OutboxSaleItem[] =>
        items.map(item =>
            item.kind === 'product'
                ? { product_id: item.productId, quantity: item.quantity, discount: item.discount }
                : { promotion_id: item.promotionId, quantity: item.quantity }
        )

    const handleCheckout = async () => {
        setProcessing(true)
        // Generated lazily so a retry of the same attempt (checkoutKey already set) reuses it. Offline, it
        // becomes the outbox entry's client_ref (F3): the same key either way, live or queued.
        const key = checkoutKey ?? crypto.randomUUID()
        if (!checkoutKey) setCheckoutKey(key)
        try {
            if (!online) {
                if (offlineWindowExpired) throw new Error('errors.offline_window_expired')
                const entry = await enqueueSale(
                    key,
                    user.id,
                    {
                        customer_id: selectedCustomer || null,
                        payment_method: paymentMethod,
                        discount,
                        items: buildSaleItems()
                    },
                    totals.total
                )
                setProvisionalReceipt(
                    buildProvisionalOrder({
                        provisionalNumber: entry.provisional_number,
                        occurredAt: entry.created_at,
                        customerName: activeCustomers.find(customer => customer.id === selectedCustomer)?.name ?? null,
                        paymentMethod,
                        cashierName: user.fullName || user.email,
                        lines,
                        totals,
                        decimals
                    })
                )
                toast.success(
                    t('orderQueuedOffline', {
                        provisionalNumber: entry.provisional_number,
                        total: money(totals.total)
                    }),
                    { action: { label: t('printTicket'), onClick: () => window.print() } }
                )
                clearCart()
                setSelectedCustomer('')
                setShowPaymentDialog(false)
                setShowCart(false)
                setCheckoutKey(null)
                return
            }
            const order = await salesApi.create(
                {
                    customer_id: selectedCustomer || null,
                    payment_method: paymentMethod,
                    items: buildSaleItems(),
                    discount
                },
                key
            )
            toast.success(t('orderCompleted', { orderNumber: order.order_number, total: money(order.total) }), {
                action: { label: t('viewOrder'), onClick: () => router.push(`/orders/${order.id}`) }
            })
            clearCart()
            setSelectedCustomer('')
            setShowPaymentDialog(false)
            setShowCart(false)
            setCheckoutKey(null)
            catalog.reload()
            activePromos.reload()
            setTopReloadSignal(count => count + 1)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('processFailed')))
            catalog.reload()
            cartProducts.reload()
            cartPromos.reload()
            activePromos.reload()
        } finally {
            setProcessing(false)
        }
    }

    const handleAddToTabClick = () => {
        setShowAddToTabDialog(true)
    }

    return (
        <>
            <div className="space-y-6 print:hidden">
                <div className="hidden lg:block">
                    <h1 className="text-3xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={t('searchPlaceholder')}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger className="w-full sm:w-48" aria-label={t('category')}>
                            <SelectValue placeholder={t('category')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
                            {categoryOptions.map(category => (
                                <SelectItem key={category.id} value={category.id}>
                                    {category.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <PromotionsStrip
                    promotions={activePromos.data?.data ?? []}
                    loading={!activePromos.data && activePromos.loading}
                    pendingId={pendingId}
                    pendingQty={pendingQty}
                    qtyInCart={qtyInCartPromo}
                    onSelect={handleSelectPromotion}
                    onChangeQty={handleChangePendingQty}
                    onConfirm={handleConfirmPending}
                />

                <TopProducts
                    reloadSignal={topReloadSignal}
                    pendingId={pendingId}
                    pendingQty={pendingQty}
                    qtyInCart={qtyInCartProduct}
                    onSelect={handleSelectProduct}
                    onChangeQty={handleChangePendingQty}
                    onConfirm={handleConfirmPending}
                />

                <ProductGrid
                    catalog={catalog}
                    pendingId={pendingId}
                    pendingQty={pendingQty}
                    qtyInCart={qtyInCartProduct}
                    onSelect={handleSelectProduct}
                    onChangeQty={handleChangePendingQty}
                    onConfirm={handleConfirmPending}
                />

                <CartBubble
                    itemCount={items.length}
                    total={totals.total}
                    lines={lines.flatMap(line => {
                        if (line.kind === 'product' && line.product) {
                            return [
                                {
                                    productId: line.item.productId,
                                    name: line.product.name,
                                    quantity: line.item.quantity
                                }
                            ]
                        }
                        if (line.kind === 'promotion' && line.promotion) {
                            return [
                                {
                                    productId: line.item.promotionId,
                                    name: line.promotion.name,
                                    quantity: line.item.quantity
                                }
                            ]
                        }
                        return []
                    })}
                    hasProblem={blocked}
                    openTabsLabel={
                        openTabs.data && openTabs.data.total > 0
                            ? tTabs('openTab') + ` (${openTabs.data.total})`
                            : undefined
                    }
                    onClick={() => setShowCart(true)}
                />

                <CartSheet
                    open={showCart}
                    onOpenChange={setShowCart}
                    lines={lines}
                    lookupSettled={lookupSettled}
                    problemWith={problemWith}
                    totals={totals}
                    discount={discount}
                    onDiscountChange={setGlobalDiscount}
                    onUpdateQuantity={updateQuantity}
                    onRemove={removeItem}
                    customers={activeCustomers}
                    selectedCustomer={selectedCustomer}
                    onSelectCustomer={setSelectedCustomer}
                    blocked={blocked}
                    offlineWindowExpired={offlineWindowExpired}
                    showPaymentDialog={showPaymentDialog}
                    onShowPaymentDialog={open => {
                        setShowPaymentDialog(open)
                        // Cancelling (or the dialog closing after success, already cleared) starts the next attempt fresh.
                        if (!open) setCheckoutKey(null)
                    }}
                    paymentMethod={paymentMethod}
                    onPaymentMethodChange={setPaymentMethod}
                    processing={processing}
                    onCheckout={handleCheckout}
                    openTabs={openTabs.data?.data ?? []}
                    openTabsLoading={!openTabs.data}
                    onOpenNewTab={() => setShowOpenTabDialog(true)}
                    onSelectTab={tabId => {
                        setSelectedTabId(tabId)
                        setShowCart(false)
                    }}
                    onAddToTab={handleAddToTabClick}
                    canAddToTab={canAddToTab}
                />

                <OpenTabDialog
                    open={showOpenTabDialog}
                    onOpenChange={setShowOpenTabDialog}
                    customers={activeCustomers}
                    onOpened={() => openTabs.reload()}
                />

                <AddToTabDialog
                    open={showAddToTabDialog}
                    onOpenChange={setShowAddToTabDialog}
                    openTabs={openTabs.data?.data ?? []}
                    customers={activeCustomers}
                    items={items.map(item =>
                        item.kind === 'product'
                            ? { product_id: item.productId, quantity: item.quantity }
                            : { promotion_id: item.promotionId, quantity: item.quantity }
                    )}
                    onAdded={() => {
                        clearCart()
                        setShowCart(false)
                        openTabs.reload()
                        catalog.reload()
                        activePromos.reload()
                    }}
                />

                <TabDetailSheet
                    tabId={selectedTabId}
                    onClose={() => setSelectedTabId(null)}
                    onChanged={() => {
                        openTabs.reload()
                        catalog.reload()
                    }}
                />
            </div>

            {provisionalReceipt && <ReceiptTicket order={provisionalReceipt} settings={settings} provisional />}
        </>
    )
}
