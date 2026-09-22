import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import type { SessionUser } from '@/components/session-provider'
import type { AppLocale } from '@/lib/i18n/config'
import type { ProductListItem } from '@/lib/api/products'
import type { SettingsInput } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import en from '@/messages/en.json'
import es from '@/messages/es.json'

const messages = { en, es } as const

export const settings: SettingsInput = {
    store_name: 'Test Store',
    store_address: '',
    store_phone: '',
    store_email: '',
    store_tax_id: '',
    store_logo_key: '',
    currency: 'USD',
    timezone: 'UTC',
    low_stock_threshold: 10,
    tax_rate: 0.1,
    receipt_template: { header: '', footer: '' }
}

export const userWithRole = (role: SessionUser['role'], locale: AppLocale = 'en'): SessionUser => ({
    id: `user-${role}`,
    email: `${role}@test.dev`,
    fullName: null,
    role,
    locale
})

/** Component tests stay on English messages so existing assertions keep working. */
export function IntlProvider({ children, locale = 'en' }: { children: ReactNode; locale?: AppLocale }) {
    return (
        <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
            {children}
        </NextIntlClientProvider>
    )
}

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

export function customer(overrides: Partial<Tables<'customers'>> = {}): Tables<'customers'> {
    return {
        id: crypto.randomUUID(),
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '555-0100',
        address: null,
        is_active: true,
        loyalty_points: 0,
        total_spent: 0,
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        ...overrides
    }
}

export function supplier(overrides: Partial<Tables<'suppliers'>> = {}): Tables<'suppliers'> {
    return {
        id: crypto.randomUUID(),
        name: 'Acme Supply Co',
        contact_person: 'John Smith',
        email: 'john@acme.example',
        phone: '555-0200',
        address: null,
        notes: null,
        is_active: true,
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        ...overrides
    }
}

export const page = <T,>(data: T[]) => ({ data, page: 1, pageSize: 25, total: data.length })

export type { ReactNode }
