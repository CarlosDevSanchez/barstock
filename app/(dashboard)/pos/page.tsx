"use client"

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { supabase } from '@/lib/supabase/client'
import { useCartStore } from '@/stores/cart'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'sonner'
import { Search, Trash2, Plus, Minus, ShoppingCart, CreditCard, DollarSign, Smartphone, Receipt } from 'lucide-react'
import type { Product, Customer } from '@/types'
import { cn } from '@/lib/utils'

export default function POSPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [filteredProducts, setFilteredProducts] = useState<Product[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string>('all')
    const [categories, setCategories] = useState<any[]>([])
    const [customers, setCustomers] = useState<Customer[]>([])
    const [selectedCustomer, setSelectedCustomer] = useState<string>('')
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'ewallet'>('cash')
    const [showPaymentDialog, setShowPaymentDialog] = useState(false)
    const [processing, setProcessing] = useState(false)

    const { items, addItem, removeItem, updateQuantity, setGlobalDiscount, discount, getSubtotal, getTax, getTotal, clearCart } = useCartStore()
    const { user } = useAuthStore()

    useEffect(() => {
        fetchProducts()
        fetchCategories()
        fetchCustomers()
    }, [])

    useEffect(() => {
        let filtered = products

        if (searchQuery) {
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
            )
        }

        if (selectedCategory !== 'all') {
            filtered = filtered.filter(p => p.category_id === selectedCategory)
        }

        setFilteredProducts(filtered)
    }, [searchQuery, selectedCategory, products])

    const fetchProducts = async () => {
        const { data } = await supabase
            .from('products')
            .select('*')
            .eq('is_active', true)

        setProducts(data || [])
        setFilteredProducts(data || [])
    }

    const fetchCategories = async () => {
        const { data } = await supabase.from('categories').select('*')
        setCategories(data || [])
    }

    const fetchCustomers = async () => {
        const { data } = await supabase.from('customers').select('*').eq('is_active', true)
        setCustomers(data || [])
    }

    const handleCheckout = async () => {
        if (items.length === 0) {
            toast.error('Cart is empty')
            return
        }

        setProcessing(true)

        try {
            // Generate order number
            const orderNumber = `ORD-${Date.now()}`

            // Create order
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    order_number: orderNumber,
                    customer_id: selectedCustomer || null,
                    status: 'completed',
                    subtotal: getSubtotal(),
                    discount: discount,
                    tax: getTax(),
                    total: getTotal(),
                    created_by: user?.id,
                })
                .select()
                .single()

            if (orderError) throw orderError

            // Create order items
            const orderItems = items.map(item => ({
                order_id: order.id,
                product_id: item.product.id,
                variant_id: item.variant?.id || null,
                quantity: item.quantity,
                unit_price: item.variant?.selling_price ?? item.product.selling_price,
                discount: item.discount,
                tax: (item.variant?.selling_price ?? item.product.selling_price) * item.quantity * (item.product.tax_rate || 0),
                total: (item.variant?.selling_price ?? item.product.selling_price) * item.quantity - item.discount,
            }))

            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(orderItems)

            if (itemsError) throw itemsError

            // Create payment
            const { error: paymentError } = await supabase
                .from('payments')
                .insert({
                    order_id: order.id,
                    payment_method: paymentMethod,
                    amount: getTotal(),
                })

            if (paymentError) throw paymentError

            // Update inventory
            for (const item of items) {
                const { data: inventory } = await supabase
                    .from('inventory')
                    .select('*')
                    .eq('product_id', item.product.id)
                    .eq('variant_id', item.variant?.id || null)
                    .single()

                if (inventory) {
                    await supabase
                        .from('inventory')
                        .update({ quantity: inventory.quantity - item.quantity })
                        .eq('id', inventory.id)

                    // Log transaction
                    await supabase
                        .from('inventory_transactions')
                        .insert({
                            inventory_id: inventory.id,
                            transaction_type: 'sale',
                            quantity: -item.quantity,
                            reference_id: order.id,
                            created_by: user?.id,
                        })
                }
            }

            toast.success('Order completed successfully!')
            clearCart()
            setSelectedCustomer('')
            setShowPaymentDialog(false)

            // Print receipt (you can implement browser print here)
            if (confirm('Print receipt?')) {
                window.print()
            }
        } catch (error: any) {
            console.error(error)
            toast.error(error.message || 'Failed to complete order')
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
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger className="w-full sm:w-48">
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {categories.map(cat => (
                                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Products Grid */}
                <ScrollArea className="flex-1">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">
                        {filteredProducts.map(product => (
                            <Card
                                key={product.id}
                                className="cursor-pointer hover:shadow-lg transition-all rounded-2xl overflow-hidden group"
                                onClick={() => addItem(product)}
                            >
                                <div className="aspect-square bg-gradient-to-br from-emerald-50 to-slate-50 dark:from-emerald-950/20 dark:to-slate-900 flex items-center justify-center">
                                    <ShoppingCart className="w-12 h-12 text-emerald-600/30 group-hover:text-emerald-600/50 transition-colors" />
                                </div>
                                <CardContent className="p-4">
                                    <h3 className="font-semibold line-clamp-2 text-sm">{product.name}</h3>
                                    <p className="text-xs text-muted-foreground mt-1">SKU: {product.sku}</p>
                                    <p className="text-lg font-bold text-emerald-600 mt-2">${product.selling_price.toFixed(2)}</p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </ScrollArea>
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
                    <div className="mb-4">
                        <Label className="text-foreground font-semibold">Customer (Optional)</Label>
                        <Select value={selectedCustomer || undefined} onValueChange={setSelectedCustomer}>
                            <SelectTrigger>
                                <SelectValue placeholder="Walk-in Customer" />
                            </SelectTrigger>
                            <SelectContent>
                                {customers.map(customer => (
                                    <SelectItem key={customer.id} value={customer.id}>
                                        {customer.name} - {customer.phone}
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
                                {items.map((item, index) => (
                                    <div key={`${item.product.id}-${item.variant?.id || 'no-variant'}-${index}`} className="flex items-center gap-3 p-3 rounded-xl bg-muted">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">{item.product.name}</p>
                                            {item.variant && (
                                                <p className="text-xs text-muted-foreground">{item.variant.name}</p>
                                            )}
                                            <p className="text-sm font-bold text-emerald-600">
                                                ${(item.variant?.selling_price ?? item.product.selling_price).toFixed(2)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="icon"
                                                variant="outline"
                                                className="h-7 w-7"
                                                onClick={() => updateQuantity(item.product.id, item.variant?.id, item.quantity - 1)}
                                            >
                                                <Minus className="h-3 w-3" />
                                            </Button>
                                            <span className="w-8 text-center font-medium">{item.quantity}</span>
                                            <Button
                                                size="icon"
                                                variant="outline"
                                                className="h-7 w-7"
                                                onClick={() => updateQuantity(item.product.id, item.variant?.id, item.quantity + 1)}
                                            >
                                                <Plus className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => removeItem(item.product.id, item.variant?.id)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>

                    {/* Summary */}
                    {items.length > 0 && (
                        <>
                            <Separator className="my-4" />
                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span>Subtotal</span>
                                    <span className="font-medium">${getSubtotal().toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span>Discount</span>
                                    <Input
                                        type="number"
                                        value={discount}
                                        onChange={(e) => setGlobalDiscount(Number(e.target.value))}
                                        className="w-24 h-8 text-right"
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span>Tax</span>
                                    <span className="font-medium">${getTax().toFixed(2)}</span>
                                </div>
                                <Separator />
                                <div className="flex justify-between text-lg font-bold">
                                    <span>Total</span>
                                    <span className="text-emerald-600">${getTotal().toFixed(2)}</span>
                                </div>

                                <Button
                                    className="w-full"
                                    size="lg"
                                    onClick={() => setShowPaymentDialog(true)}
                                    disabled={items.length === 0}
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
            <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Complete Payment</DialogTitle>
                        <DialogDescription>
                            Total amount: <span className="text-lg font-bold text-emerald-600">${getTotal().toFixed(2)}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label className="text-foreground font-semibold">Payment Method</Label>
                            <div className="grid grid-cols-3 gap-2">
                                <Button
                                    variant={paymentMethod === 'cash' ? 'default' : 'outline'}
                                    className="flex flex-col h-auto py-4"
                                    onClick={() => setPaymentMethod('cash')}
                                >
                                    <DollarSign className="h-6 w-6 mb-1" />
                                    <span className="text-xs">Cash</span>
                                </Button>
                                <Button
                                    variant={paymentMethod === 'card' ? 'default' : 'outline'}
                                    className="flex flex-col h-auto py-4"
                                    onClick={() => setPaymentMethod('card')}
                                >
                                    <CreditCard className="h-6 w-6 mb-1" />
                                    <span className="text-xs">Card</span>
                                </Button>
                                <Button
                                    variant={paymentMethod === 'ewallet' ? 'default' : 'outline'}
                                    className="flex flex-col h-auto py-4"
                                    onClick={() => setPaymentMethod('ewallet')}
                                >
                                    <Smartphone className="h-6 w-6 mb-1" />
                                    <span className="text-xs">E-Wallet</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
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
