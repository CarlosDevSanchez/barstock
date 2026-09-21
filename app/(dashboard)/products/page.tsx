'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Plus, Search, Edit, Trash2, Package } from 'lucide-react'
import type { Product, Category } from '@/types'

export default function ProductsPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [showDialog, setShowDialog] = useState(false)
    const [editingProduct, setEditingProduct] = useState<Product | null>(null)
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        sku: '',
        barcode: '',
        category_id: '',
        cost_price: '',
        selling_price: '',
        tax_rate: '0.1',
        is_active: true
    })

    useEffect(() => {
        fetchProducts()
        fetchCategories()
    }, [])

    const fetchProducts = async () => {
        const { data } = await supabase
            .from('products')
            .select('*, category:categories(*)')
            .order('created_at', { ascending: false })
        setProducts(data || [])
    }

    const fetchCategories = async () => {
        const { data } = await supabase.from('categories').select('*')
        setCategories(data || [])
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        try {
            const productData = {
                ...formData,
                cost_price: parseFloat(formData.cost_price),
                selling_price: parseFloat(formData.selling_price),
                tax_rate: parseFloat(formData.tax_rate)
            }

            if (editingProduct) {
                const { error } = await supabase.from('products').update(productData).eq('id', editingProduct.id)

                if (error) throw error
                toast.success('Product updated successfully')
            } else {
                const { error } = await supabase.from('products').insert(productData)

                if (error) throw error
                toast.success('Product created successfully')
            }

            setShowDialog(false)
            resetForm()
            fetchProducts()
        } catch (error: any) {
            toast.error(error.message || 'Failed to save product')
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this product?')) return

        try {
            const { error } = await supabase.from('products').delete().eq('id', id)

            if (error) throw error
            toast.success('Product deleted successfully')
            fetchProducts()
        } catch (error: any) {
            toast.error(error.message || 'Failed to delete product')
        }
    }

    const handleEdit = (product: Product) => {
        setEditingProduct(product)
        setFormData({
            name: product.name,
            description: product.description || '',
            sku: product.sku,
            barcode: product.barcode || '',
            category_id: product.category_id || '',
            cost_price: product.cost_price.toString(),
            selling_price: product.selling_price.toString(),
            tax_rate: product.tax_rate.toString(),
            is_active: product.is_active
        })
        setShowDialog(true)
    }

    const resetForm = () => {
        setEditingProduct(null)
        setFormData({
            name: '',
            description: '',
            sku: '',
            barcode: '',
            category_id: '',
            cost_price: '',
            selling_price: '',
            tax_rate: '0.1',
            is_active: true
        })
    }

    const filteredProducts = products.filter(
        p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.sku.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Products</h1>
                    <p className="text-muted-foreground">Manage your product catalog</p>
                </div>
                <Button
                    onClick={() => {
                        resetForm()
                        setShowDialog(true)
                    }}
                >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Product
                </Button>
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search products..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                </div>

                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Cost</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredProducts.map(product => (
                            <TableRow key={product.id}>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                            <Package className="h-4 w-4 text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{product.name}</p>
                                            <p className="text-sm text-muted-foreground">{product.description}</p>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                                <TableCell>{product.category?.name || '-'}</TableCell>
                                <TableCell>${product.cost_price.toFixed(2)}</TableCell>
                                <TableCell className="font-semibold text-emerald-600">
                                    ${product.selling_price.toFixed(2)}
                                </TableCell>
                                <TableCell>
                                    <Badge variant={product.is_active ? 'default' : 'secondary'}>
                                        {product.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => handleEdit(product)}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-red-600 hover:text-red-700"
                                            onClick={() => handleDelete(product.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>

            {/* Add/Edit Dialog */}
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</DialogTitle>
                        <DialogDescription>
                            {editingProduct ? 'Update product details' : 'Fill in the product information'}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                        <div className="grid grid-cols-2 gap-4 py-4 overflow-y-auto px-1">
                            <div className="col-span-2 space-y-2">
                                <Label htmlFor="name" className="text-foreground font-semibold">
                                    Product Name *
                                </Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="col-span-2 space-y-2">
                                <Label htmlFor="description" className="text-foreground font-semibold">
                                    Description
                                </Label>
                                <Input
                                    id="description"
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="sku" className="text-foreground font-semibold">
                                    SKU *
                                </Label>
                                <Input
                                    id="sku"
                                    value={formData.sku}
                                    onChange={e => setFormData({ ...formData, sku: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="barcode" className="text-foreground font-semibold">
                                    Barcode
                                </Label>
                                <Input
                                    id="barcode"
                                    value={formData.barcode}
                                    onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="category" className="text-foreground font-semibold">
                                    Category
                                </Label>
                                <Select
                                    value={formData.category_id || undefined}
                                    onValueChange={value => setFormData({ ...formData, category_id: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.map(cat => (
                                            <SelectItem key={cat.id} value={cat.id}>
                                                {cat.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tax_rate" className="text-foreground font-semibold">
                                    Tax Rate
                                </Label>
                                <Input
                                    id="tax_rate"
                                    type="number"
                                    step="0.01"
                                    value={formData.tax_rate}
                                    onChange={e => setFormData({ ...formData, tax_rate: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cost_price" className="text-foreground font-semibold">
                                    Cost Price *
                                </Label>
                                <Input
                                    id="cost_price"
                                    type="number"
                                    step="0.01"
                                    value={formData.cost_price}
                                    onChange={e => setFormData({ ...formData, cost_price: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="selling_price" className="text-foreground font-semibold">
                                    Selling Price *
                                </Label>
                                <Input
                                    id="selling_price"
                                    type="number"
                                    step="0.01"
                                    value={formData.selling_price}
                                    onChange={e => setFormData({ ...formData, selling_price: e.target.value })}
                                    required
                                />
                            </div>
                        </div>
                        <DialogFooter className="mt-4">
                            <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                                Cancel
                            </Button>
                            <Button type="submit">{editingProduct ? 'Update Product' : 'Create Product'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
