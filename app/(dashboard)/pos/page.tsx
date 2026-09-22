'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { currencyDecimals } from '@/lib/money'
import { categoriesApi } from '@/lib/api/categories'
import { errorMessage } from '@/lib/api/client'
import { customersApi } from '@/lib/api/customers'
import { productsApi, type ProductListItem } from '@/lib/api/products'
import { salesApi } from '@/lib/api/orders'
import { tabsApi } from '@/lib/api/tabs'
import { previewTotals } from '@/lib/cart-preview'
import { useMoney, useSession } from '@/components/session-provider'
import type { PaymentMethod } from '@/types'
import { useCartStore } from '@/stores/cart'
import { useApiQuery } from '@/hooks/use-api-query'
import { useInfiniteApiList } from '@/hooks/use-infinite-api-list'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { AddToTabDialog } from '@/components/pos/add-to-tab-dialog'
import { CartBubble } from '@/components/pos/cart-bubble'
import { CartSheet, type CartLineView } from '@/components/pos/cart-sheet'
import { OpenTabDialog } from '@/components/pos/open-tab-dialog'
import { ProductGrid } from '@/components/pos/product-grid'
import { TabDetailSheet } from '@/components/pos/tab-detail-sheet'
import { TopProducts } from '@/components/pos/top-products'

const PAGE_SIZE = 30
const ALL = 'all'

export default function POSPage() {
    const t = useTranslations('pos')
    const tTabs = useTranslations('tabs')
    const router = useRouter()
    const { settings } = useSession()
    const money = useMoney()
    const decimals = currencyDecimals(settings.currency)

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
    const search = useDebouncedValue(searchQuery)

    const items = useCartStore(state => state.items)
    const discount = useCartStore(state => state.discount)
    const { addItem, removeItem, updateQuantity, setGlobalDiscount, clearCart } = useCartStore()

    const catalog = useInfiniteApiList<ProductListItem>(
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
    const categories = useApiQuery(signal => categoriesApi.list({ pageSize: 100 }, signal), 'categories')
    const customers = useApiQuery(signal => customersApi.list({ pageSize: 100 }, signal), 'customers')
    const openTabs = useApiQuery(signal => tabsApi.list({ status: 'open', pageSize: 100 }, signal), 'open-tabs')

    // The cart only holds ids: the lines are priced from live data, so a price or stock change is reflected immediately.
    const cartIds = items
        .map(item => item.productId)
        .sort()
        .join(',')
    const cartProducts = useApiQuery(
        signal => (cartIds ? productsApi.list({ ids: cartIds, pageSize: 100 }, signal) : Promise.resolve(null)),
        `cart:${cartIds}`
    )
    const products = useMemo(() => {
        const map = new Map<string, ProductListItem>()
        for (const product of catalog.items) map.set(product.id, product)
        for (const product of cartProducts.data?.data ?? []) map.set(product.id, product)
        return map
    }, [catalog.items, cartProducts.data])

    const lines: CartLineView[] = items.map(item => ({ item, product: products.get(item.productId) }))
    // Until the live lookup settles a missing product is just "not loaded yet"; afterwards it means deleted or hidden.
    const lookupSettled = cartIds === '' || (cartProducts.data !== undefined && !cartProducts.loading)
    const problemWith = ({ item, product }: CartLineView) => {
        if (!product) return lookupSettled ? t('noLongerAvailable') : null
        if (!product.is_active || product.stock === null) return t('noLongerAvailable')
        if (item.quantity > product.stock) return t('onlyInStock', { count: product.stock })
        return null
    }
    // Checkout stays disabled while any line cannot be sold (or is still loading): the server would refuse it anyway.
    const blocked = lines.some(line => !line.product || problemWith(line) !== null)
    const totals = previewTotals(
        lines.flatMap(({ item, product }) =>
            product
                ? [
                      {
                          unitPrice: product.selling_price,
                          taxRate: product.tax_rate,
                          quantity: item.quantity,
                          discount: item.discount
                      }
                  ]
                : []
        ),
        discount,
        decimals
    )
    const activeCustomers = (customers.data?.data ?? []).filter(customer => customer.is_active)

    const handleCheckout = async () => {
        setProcessing(true)
        try {
            const order = await salesApi.create({
                customer_id: selectedCustomer || null,
                payment_method: paymentMethod,
                items: items.map(item => ({
                    product_id: item.productId,
                    quantity: item.quantity,
                    discount: item.discount
                })),
                discount
            })
            // The receipt total comes from the server, which priced the sale from the database.
            toast.success(t('orderCompleted', { orderNumber: order.order_number, total: money(order.total) }), {
                action: { label: t('viewOrder'), onClick: () => router.push(`/orders/${order.id}`) }
            })
            clearCart()
            setSelectedCustomer('')
            setShowPaymentDialog(false)
            setShowCart(false)
            catalog.reload()
            setTopReloadSignal(count => count + 1)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('processFailed')))
            // Most failures are stock or price changes: refresh what the till shows.
            catalog.reload()
            cartProducts.reload()
        } finally {
            setProcessing(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div>
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
                        {(categories.data?.data ?? []).map(category => (
                            <SelectItem key={category.id} value={category.id}>
                                {category.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <TopProducts reloadSignal={topReloadSignal} onAdd={addItem} />

            <ProductGrid catalog={catalog} onAdd={addItem} />

            <CartBubble
                itemCount={items.length}
                total={totals.total}
                lines={lines.flatMap(({ item, product }) =>
                    product ? [{ productId: item.productId, name: product.name, quantity: item.quantity }] : []
                )}
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
                showPaymentDialog={showPaymentDialog}
                onShowPaymentDialog={setShowPaymentDialog}
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
                onAddToTab={() => setShowAddToTabDialog(true)}
                canAddToTab={lines.length > 0 && !blocked}
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
                items={items.map(item => ({ product_id: item.productId, quantity: item.quantity }))}
                onAdded={() => {
                    clearCart()
                    setShowCart(false)
                    openTabs.reload()
                    catalog.reload()
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
    )
}
