// Database types
export type UserRole = 'admin' | 'manager' | 'cashier'
export type PaymentMethod = 'cash' | 'card' | 'ewallet'
export type OrderStatus = 'draft' | 'pending' | 'completed' | 'refunded'
export type POStatus = 'draft' | 'pending' | 'received' | 'cancelled'

export interface Profile {
    id: string
    email: string
    full_name: string | null
    role: UserRole
    avatar_url: string | null
    phone: string | null
    created_at: string
    updated_at: string
}

export interface Category {
    id: string
    name: string
    description: string | null
    parent_id: string | null
    created_at: string
    updated_at: string
}

export interface Product {
    id: string
    name: string
    description: string | null
    sku: string
    barcode: string | null
    category_id: string | null
    cost_price: number
    selling_price: number
    tax_rate: number
    image_url: string | null
    is_active: boolean
    created_at: string
    updated_at: string
    category?: Category
}

export interface ProductVariant {
    id: string
    product_id: string
    name: string
    variant_type: string
    sku: string
    barcode: string | null
    cost_price: number | null
    selling_price: number | null
    created_at: string
}

export interface Inventory {
    id: string
    product_id: string
    variant_id: string | null
    quantity: number
    low_stock_threshold: number
    location: string | null
    last_restocked_at: string | null
    created_at: string
    updated_at: string
    product?: Product
    variant?: ProductVariant
}

export interface InventoryTransaction {
    id: string
    inventory_id: string
    transaction_type: 'purchase' | 'sale' | 'adjustment' | 'return'
    quantity: number
    reference_id: string | null
    notes: string | null
    created_by: string | null
    created_at: string
}

export interface Supplier {
    id: string
    name: string
    contact_person: string | null
    email: string | null
    phone: string | null
    address: string | null
    notes: string | null
    is_active: boolean
    created_at: string
    updated_at: string
}

export interface PurchaseOrder {
    id: string
    po_number: string
    supplier_id: string | null
    status: POStatus
    total_amount: number
    notes: string | null
    ordered_by: string | null
    received_by: string | null
    ordered_at: string | null
    received_at: string | null
    created_at: string
    updated_at: string
    supplier?: Supplier
    items?: PurchaseOrderItem[]
}

export interface PurchaseOrderItem {
    id: string
    purchase_order_id: string
    product_id: string | null
    variant_id: string | null
    quantity: number
    unit_price: number
    total: number
    created_at: string
    product?: Product
    variant?: ProductVariant
}

export interface Customer {
    id: string
    name: string
    email: string | null
    phone: string | null
    address: string | null
    loyalty_points: number
    total_spent: number
    is_active: boolean
    created_at: string
    updated_at: string
}

export interface Order {
    id: string
    order_number: string
    customer_id: string | null
    status: OrderStatus
    subtotal: number
    discount: number
    tax: number
    total: number
    notes: string | null
    created_by: string | null
    created_at: string
    updated_at: string
    customer?: Customer
    items?: OrderItem[]
    payments?: Payment[]
}

export interface OrderItem {
    id: string
    order_id: string
    product_id: string | null
    variant_id: string | null
    quantity: number
    unit_price: number
    discount: number
    tax: number
    total: number
    created_at: string
    product?: Product
    variant?: ProductVariant
}

export interface Payment {
    id: string
    order_id: string
    payment_method: PaymentMethod
    amount: number
    reference_number: string | null
    notes: string | null
    created_at: string
}

export interface Expense {
    id: string
    category: string
    description: string
    amount: number
    date: string
    created_by: string | null
    created_at: string
    updated_at: string
}

export interface Settings {
    id: string
    key: string
    value: any
    created_at: string
    updated_at: string
}

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
