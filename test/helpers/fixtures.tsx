import type { ReactNode } from 'react'
import type { SessionUser } from '@/components/session-provider'
import type { ProductListItem } from '@/lib/api/products'
import type { SettingsInput } from '@/lib/validation/resources'

export const settings: SettingsInput = {
    store_name: 'Test Store',
    store_address: '',
    store_phone: '',
    store_email: '',
    currency: 'USD',
    timezone: 'UTC',
    low_stock_threshold: 10,
    tax_rate: 0.1,
    receipt_template: { header: '', footer: '' }
}

export const userWithRole = (role: SessionUser['role']): SessionUser => ({
    id: `user-${role}`,
    email: `${role}@test.dev`,
    fullName: null,
    role
})

export function product(overrides: Partial<ProductListItem> = {}): ProductListItem {
    return {
        id: crypto.randomUUID(),
        name: 'Wireless Mouse',
        description: null,
        sku: 'ELEC-001',
        barcode: null,
        category_id: null,
        cost_price: 15,
        selling_price: 29.99,
        tax_rate: 0.1,
        image_url: null,
        is_active: true,
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        category: null,
        stock: 5,
        ...overrides
    }
}

export const page = <T,>(data: T[]) => ({ data, page: 1, pageSize: 25, total: data.length })

export type { ReactNode }
