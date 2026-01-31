export const APP_NAME = 'POS Inventory System'

export const ROLES = {
    ADMIN: 'admin',
    MANAGER: 'manager',
    CASHIER: 'cashier',
} as const

export const PAYMENT_METHODS = {
    CASH: 'cash',
    CARD: 'card',
    EWALLET: 'ewallet',
} as const

export const ORDER_STATUS = {
    DRAFT: 'draft',
    PENDING: 'pending',
    COMPLETED: 'completed',
    REFUNDED: 'refunded',
} as const

export const PO_STATUS = {
    DRAFT: 'draft',
    PENDING: 'pending',
    RECEIVED: 'received',
    CANCELLED: 'cancelled',
} as const

export const CURRENCY = {
    USD: 'USD',
    EUR: 'EUR',
    GBP: 'GBP',
} as const

export const TAX_RATE_DEFAULT = 0.1 // 10%
