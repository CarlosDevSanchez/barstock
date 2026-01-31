"use client"

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase/client'
import { Warehouse, AlertTriangle, TrendingUp, Search } from 'lucide-react'
import type { Inventory, Product } from '@/types'

export default function InventoryPage() {
    const [inventory, setInventory] = useState<(Inventory & { product: Product })[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchInventory()
    }, [])

    const fetchInventory = async () => {
        const { data } = await supabase
            .from('inventory')
            .select('*, product: products(*)')
            .order('quantity', { ascending: true })

        setInventory(data as any || [])
        setLoading(false)
    }

    const filteredInventory = inventory.filter(item =>
        item.product?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.product?.sku.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const lowStockCount = inventory.filter(item => item.quantity < item.low_stock_threshold).length
    const totalItems = inventory.reduce((sum, item) => sum + item.quantity, 0)

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Inventory Management</h1>
                <p className="text-muted-foreground">Track and manage your stock levels</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Items</CardTitle>
                        <Warehouse className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalItems}</div>
                        <p className="text-xs text-muted-foreground">Across {inventory.length} products</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl border-red-100 dark:border-red-900/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Low Stock Alert</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{lowStockCount}</div>
                        <p className="text-xs text-muted-foreground">Products need restocking</p>
                    </CardContent>
                </Card>

                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
                        <TrendingUp className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            ${inventory.reduce((sum, item) => sum + (item.quantity * (item.product?.cost_price || 0)), 0).toFixed(2)}
                        </div>
                        <p className="text-xs text-muted-foreground">Total inventory value</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="rounded-2xl p-6">
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search inventory..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                </div>

                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead>Quantity</TableHead>
                            <TableHead>Min Threshold</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Value</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredInventory.map((item) => {
                            const isLowStock = item.quantity < item.low_stock_threshold
                            return (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.product?.name}</TableCell>
                                    <TableCell className="font-mono text-sm">{item.product?.sku}</TableCell>
                                    <TableCell>
                                        <span className={isLowStock ? 'text-red-600 font-bold' : 'font-semibold'}>
                                            {item.quantity}
                                        </span>
                                    </TableCell>
                                    <TableCell>{item.low_stock_threshold}</TableCell>
                                    <TableCell>
                                        <Badge variant={isLowStock ? 'destructive' : 'default'}>
                                            {isLowStock ? 'Low Stock' : 'In Stock'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        ${(item.quantity * (item.product?.cost_price || 0)).toFixed(2)}
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </Card>
        </div>
    )
}
