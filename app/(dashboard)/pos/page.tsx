'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Trash2, Plus, Minus, ShoppingCart, CreditCard, DollarSign, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { QueryError } from '@/components/query-error'
import { PageSpinner } from '@/components/page-spinner'
import { useMoney } from '@/components/session-provider'
import { categoriesApi } from '@/lib/api/categories'
import { errorMessage } from '@/lib/api/client'
import { customersApi } from '@/lib/api/customers'
import { productsApi, type ProductListItem } from '@/lib/api/products'
import { salesApi } from '@/lib/api/orders'
import { previewTotals } from '@/lib/cart-preview'
import type { PaymentMethod } from '@/types'
import { useCartStore } from '@/stores/cart'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const CATALOG_SIZE = 100
const ALL = 'all'

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string; icon: typeof DollarSign }> = [
    { value: 'cash', label: 'Cash', icon: DollarSign },
    { value: 'card', label: 'Card', icon: CreditCard },
    { value: 'ewallet', label: 'E-Wallet', icon: Smartphone }
]

export default function POSPage() {
    const router = useRouter()
    const money = useMoney()

    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState(ALL)
    const [selectedCustomer, setSelectedCustomer] = useState('')
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
    const [showPaymentDialog, setShowPaymentDialog] = useState(false)
    const [processing, setProcessing] = useState(false)
    const search = useDebouncedValue(searchQuery)

    const items = useCartStore(state => state.items)
    const discount = useCartStore(state => state.discount)
    const { addItem, removeItem, updateQuantity, setGlobalDiscount, clearCart } = useCartStore()

    const catalog = useApiQuery(
        signal =>
            productsApi.list(
                {
                    pageSize: CATALOG_SIZE,
                    q: search,
                    category_id: selectedCategory === ALL ? undefined : selectedCategory,
                    active: true
                },
                signal
            ),
        JSON.stringify({ search, selectedCategory })
    )
    const categories = useApiQuery(signal => categoriesApi.list({ pageSize: 100 }, signal), 'categories')
    const customers = useApiQuery(signal => customersApi.list({ pageSize: 100 }, signal), 'customers')

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
        for (const product of catalog.data?.data ?? []) map.set(product.id, product)
        for (const product of cartProducts.data?.data ?? []) map.set(product.id, product)
        return map
    }, [catalog.data, cartProducts.data])

    const lines = items.map(item => ({ item, product: products.get(item.productId) }))
    // Until the live lookup settles a missing product is just "not loaded yet"; afterwards it means deleted or hidden.
    const lookupSettled = cartIds === '' || (cartProducts.data !== undefined && !cartProducts.loading)
    const problemWith = ({ item, product }: (typeof lines)[number]) => {
        if (!product) return lookupSettled ? 'No longer available' : null
        if (!product.is_active || product.stock === null) return 'No longer available'
        if (item.quantity > product.stock) return `Only ${product.stock} in stock`
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
        discount
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
            toast.success(`Order ${order.order_number} completed: ${money(order.total)}`, {
                action: { label: 'View order', onClick: () => router.push(`/orders/${order.id}`) }
            })
            clearCart()
            setSelectedCustomer('')
            setShowPaymentDialog(false)
            catalog.reload()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to process order'))
            // Most failures are stock or price changes: refresh what the till shows.
            catalog.reload()
            cartProducts.reload()
        } finally {
            setProcessing(false)
        }
    }

    return (
        <div className="h-full flex flex-col lg:flex-row gap-4">
            {/* Products Section */}
            <div className="flex-1 flex flex-col space-y-4">
                <div>
                    <h1 className="text-3xl font-bold">Point of Sale</h1>
                    <p className="text-muted-foreground">Scan or select products to add to cart</p>
                </div>

                {/* Search and Filter */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name, SKU, or barcode..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger className="w-full sm:w-48" aria-label="Category">
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>All Categories</SelectItem>
                            {(categories.data?.data ?? []).map(category => (
                                <SelectItem key={category.id} value={category.id}>
                                    {category.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Products Grid */}
                {catalog.error ? (
                    <QueryError error={catalog.error} onRetry={catalog.reload} />
                ) : !catalog.data ? (
                    <PageSpinner />
                ) : (
                    <ScrollArea className="flex-1">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">
                            {catalog.data.data.map(product => {
                                // stock null = no inventory row, which the database refuses to sell.
                                const soldOut = product.stock === null || product.stock <= 0
                                return (
                                    <Card
                                        key={product.id}
                                        role="button"
                                        aria-disabled={soldOut}
                                        aria-label={`Add ${product.name} to cart`}
                                        tabIndex={soldOut ? -1 : 0}
                                        className={`transition-all rounded-2xl overflow-hidden group ${
                                            soldOut ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-lg'
                                        }`}
                                        onClick={() => !soldOut && addItem(product.id)}
                                        onKeyDown={e => {
                                            if (!soldOut && (e.key === 'Enter' || e.key === ' ')) {
                                                e.preventDefault()
                                                addItem(product.id)
                                            }
                                        }}
                                    >
                                        <div className="aspect-square bg-gradient-to-br from-emerald-50 to-slate-50 dark:from-emerald-950/20 dark:to-slate-900 flex items-center justify-center">
                                            <ShoppingCart className="w-12 h-12 text-emerald-600/30 group-hover:text-emerald-600/50 transition-colors" />
                                        </div>
                                        <CardContent className="p-4">
                                            <h3 className="font-semibold line-clamp-2 text-sm">{product.name}</h3>
                                            <p className="text-xs text-muted-foreground mt-1">SKU: {product.sku}</p>
                                            <div className="flex items-center justify-between mt-2">
                                                <p className="text-lg font-bold text-emerald-600">
                                                    {money(product.selling_price)}
                                                </p>
                                                <Badge variant={soldOut ? 'destructive' : 'secondary'}>
                                                    {soldOut ? 'Out of stock' : `${product.stock} left`}
                                                </Badge>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                        {catalog.data.data.length === 0 && (
                            <p className="py-8 text-center text-muted-foreground">No products found</p>
                        )}
                        {catalog.data.total > catalog.data.data.length && (
                            <p className="pb-4 text-center text-sm text-muted-foreground">
                                Showing {catalog.data.data.length} of {catalog.data.total} products. Refine the search
                                to see the rest.
                            </p>
                        )}
                    </ScrollArea>
                )}
            </div>

            {/* Cart Section */}
            <Card className="w-full lg:w-96 rounded-2xl shadow-xl flex flex-col">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5 text-emerald-600" />
                        Cart ({items.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                    {/* Customer Selection */}
                    <div className="mb-4 space-y-2">
                        <Label className="text-foreground font-semibold">Customer (Optional)</Label>
                        <Select
                            value={selectedCustomer || undefined}
                            onValueChange={value => setSelectedCustomer(value === '__walk_in__' ? '' : value)}
                        >
                            <SelectTrigger aria-label="Customer">
                                <SelectValue placeholder="Walk-in Customer" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__walk_in__">Walk-in Customer</SelectItem>
                                {activeCustomers.map(customer => (
                                    <SelectItem key={customer.id} value={customer.id}>
                                        {customer.name}
                                        {customer.phone ? ` - ${customer.phone}` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <Separator className="my-3" />

                    {/* Cart Items */}
                    <ScrollArea className="flex-1 -mx-6 px-6">
                        {items.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <ShoppingCart className="h-16 w-16 text-muted-foreground/30 mb-4" />
                                <p className="text-muted-foreground">Cart is empty</p>
                                <p className="text-sm text-muted-foreground">Add products to get started</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {lines.map(line => {
                                    const { item, product } = line
                                    const problem = problemWith(line)
                                    return (
                                        <div
                                            key={item.productId}
                                            className="flex items-center gap-3 p-3 rounded-xl bg-muted"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm truncate">
                                                    {product?.name ?? (lookupSettled ? 'Unknown product' : 'Loading…')}
                                                </p>
                                                {product && (
                                                    <p className="text-sm font-bold text-emerald-600">
                                                        {money(product.selling_price)}
                                                    </p>
                                                )}
                                                {problem && <p className="text-xs text-red-600">{problem}</p>}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    className="h-7 w-7"
                                                    aria-label="Decrease quantity"
                                                    onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                                                >
                                                    <Minus className="h-3 w-3" />
                                                </Button>
                                                <span className="w-8 text-center font-medium">{item.quantity}</span>
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    className="h-7 w-7"
                                                    aria-label="Increase quantity"
                                                    disabled={
                                                        !!product &&
                                                        product.stock !== null &&
                                                        item.quantity >= product.stock
                                                    }
                                                    onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                                                >
                                                    <Plus className="h-3 w-3" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                    aria-label="Remove from cart"
                                                    onClick={() => removeItem(item.productId)}
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </ScrollArea>

                    {/* Summary (preview: the server prices the sale) */}
                    {items.length > 0 && (
                        <>
                            <Separator className="my-4" />
                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span>Subtotal</span>
                                    <span className="font-medium">{money(totals.subtotal)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span>Tax</span>
                                    <span className="font-medium">{money(totals.tax)}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span>Discount</span>
                                    <Input
                                        type="number"
                                        aria-label="Discount"
                                        value={discount}
                                        onChange={e => setGlobalDiscount(Number(e.target.value) || 0)}
                                        className="w-24 h-8 text-right"
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                                <Separator />
                                <div className="flex justify-between text-lg font-bold">
                                    <span>Total</span>
                                    <span className="text-emerald-600">{money(totals.total)}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Estimate. The final amount is calculated when the sale is completed.
                                </p>

                                <Button
                                    className="w-full"
                                    size="lg"
                                    onClick={() => setShowPaymentDialog(true)}
                                    disabled={items.length === 0 || blocked}
                                >
                                    <CreditCard className="mr-2 h-5 w-5" />
                                    Checkout
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Payment Dialog */}
            <Dialog open={showPaymentDialog} onOpenChange={open => !processing && setShowPaymentDialog(open)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Complete Payment</DialogTitle>
                        <DialogDescription>
                            Estimated total:{' '}
                            <span className="text-lg font-bold text-emerald-600">{money(totals.total)}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Payment Method</Label>
                            <div className="grid grid-cols-3 gap-2">
                                {PAYMENT_OPTIONS.map(({ value, label, icon: Icon }) => (
                                    <Button
                                        key={value}
                                        variant={paymentMethod === value ? 'default' : 'outline'}
                                        aria-pressed={paymentMethod === value}
                                        className="flex flex-col h-auto py-4"
                                        onClick={() => setPaymentMethod(value)}
                                    >
                                        <Icon className="h-6 w-6 mb-1" />
                                        <span className="text-xs">{label}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" disabled={processing} onClick={() => setShowPaymentDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCheckout} disabled={processing}>
                            {processing ? 'Processing...' : 'Complete Order'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
