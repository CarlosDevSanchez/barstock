// Application types derived from the generated database types (`bun run db:types` -> types/database.ts).
// Never hand-write a table shape here: regenerate instead. Only relations and API-level shapes are added.
import type { Enums, Tables } from './database'

export type { Json } from './database'

export type UserRole = Enums<'user_role'>
export type PaymentMethod = Enums<'payment_method'>
export type OrderStatus = Enums<'order_status'>
export type POStatus = Enums<'po_status'>

export type Profile = Tables<'profiles'>
export type Category = Tables<'categories'>
export type Product = Tables<'products'> & { category?: Category }
export type ProductVariant = Tables<'product_variants'>
export type Inventory = Tables<'inventory'> & { product?: Product; variant?: ProductVariant }
// `transaction_type` is TEXT + CHECK in the database, so the generated type is `string`.
export type InventoryTransaction = Omit<Tables<'inventory_transactions'>, 'transaction_type'> & {
    transaction_type: 'purchase' | 'sale' | 'adjustment' | 'return'
}
export type Supplier = Tables<'suppliers'>
export type PurchaseOrder = Tables<'purchase_orders'> & { supplier?: Supplier; items?: PurchaseOrderItem[] }
export type PurchaseOrderItem = Tables<'purchase_order_items'> & { product?: Product; variant?: ProductVariant }
export type Customer = Tables<'customers'>
export type Order = Tables<'orders'> & { customer?: Customer; items?: OrderItem[]; payments?: Payment[] }
export type OrderItem = Tables<'order_items'> & { product?: Product; variant?: ProductVariant }
export type Payment = Tables<'payments'>
export type Expense = Tables<'expenses'>
export type Settings = Tables<'settings'>

// Cart item for POS
export interface CartItem {
    product: Product
    variant?: ProductVariant
    quantity: number
    discount: number
}

// Dashboard stats
export interface DashboardStats {
    todayRevenue: number
    monthlyRevenue: number
    todayOrders: number
    totalCustomers: number
    lowStockCount: number
}
