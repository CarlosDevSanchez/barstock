import { afterEach, describe, expect, test } from 'bun:test'
import { IntlProvider, settings } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import type { OrderDetail } from '@/lib/api/orders'

setupDom()
const { cleanup, render, screen, within } = await import('@testing-library/react')
const { ReceiptTicket } = await import('@/components/orders/receipt-ticket')

afterEach(cleanup)

const baseOrder: OrderDetail = {
    id: 'order-1',
    order_number: 'ORD-260921-000001',
    customer_id: null,
    status: 'completed',
    subtotal: 120,
    discount: 0,
    tax: 21,
    total: 141,
    notes: null,
    tab_id: null,
    created_by: 'user-1',
    created_at: '2026-09-21T15:30:00Z',
    updated_at: '2026-09-21T15:30:00Z',
    refunded_at: null,
    refunded_by: null,
    refund_reason: null,
    customer: null,
    created_by_name: 'Jane Cashier',
    tab: null,
    payments: [
        {
            id: 'pay-1',
            order_id: 'order-1',
            payment_method: 'cash',
            amount: 141,
            reference_number: null,
            notes: null,
            created_at: '2026-09-21T15:30:00Z'
        }
    ],
    items: [
        {
            id: 'item-1',
            order_id: 'order-1',
            product_id: 'p-1',
            variant_id: null,
            promotion_id: null,
            quantity: 1,
            unit_price: 100,
            discount: 0,
            tax: 19,
            tax_rate: 0.19,
            total: 119,
            created_at: '2026-09-21T15:30:00Z',
            product: { id: 'p-1', name: 'Aguardiente', sku: 'AGU-1' },
            variant: null,
            promotion: null
        },
        {
            id: 'item-2',
            order_id: 'order-1',
            product_id: 'p-2',
            variant_id: null,
            promotion_id: null,
            quantity: 2,
            unit_price: 10,
            discount: 0,
            tax: 2,
            tax_rate: 0.1,
            total: 22,
            created_at: '2026-09-21T15:30:00Z',
            product: { id: 'p-2', name: 'Papas', sku: 'PAP-1' },
            variant: null,
            promotion: null
        }
    ]
}

const testSettings = {
    ...settings,
    store_name: 'Bar Test',
    store_tax_id: '900123456-7',
    receipt_template: { header: 'Bienvenido', footer: 'Gracias por su visita' }
}

describe('ReceiptTicket', () => {
    test('renders the store header, the NIT, items, totals and the tax breakdown grouped by rate', () => {
        render(
            <IntlProvider>
                <ReceiptTicket order={baseOrder} settings={testSettings} />
            </IntlProvider>
        )
        expect(screen.getByText('Bar Test')).toBeTruthy()
        expect(screen.getByText('NIT 900123456-7')).toBeTruthy()
        expect(screen.getByText('SALES RECEIPT — Not an electronic invoice')).toBeTruthy()
        expect(screen.getByText('Order #ORD-260921-000001')).toBeTruthy()
        expect(screen.getByText('Aguardiente')).toBeTruthy()
        expect(screen.getByText('Papas')).toBeTruthy()
        expect(screen.getByText('Bienvenido')).toBeTruthy()
        expect(screen.getByText('Gracias por su visita')).toBeTruthy()
        expect(screen.getByText('Items: 3')).toBeTruthy()

        // Tax breakdown groups by rate: "19%"/"10%" appear once in the items table and once in the breakdown table.
        expect(screen.getAllByText('19%')).toHaveLength(2)
        expect(screen.getAllByText('10%')).toHaveLength(2)
        expect(screen.getByText('Tax breakdown')).toBeTruthy()

        // Dedicated payments section: method + amount for the single cash payment. Scoped: the ticket's own
        // "Total" line can (legitimately) show the same amount when there is a single, full payment.
        const payments = within(screen.getByTestId('receipt-payments'))
        expect(payments.getByText('Payments')).toBeTruthy()
        expect(payments.getByText('Cash')).toBeTruthy()
        expect(payments.getByText('$141.00')).toBeTruthy()

        // Not refunded: no stamp.
        expect(screen.queryByText('REFUNDED')).toBeNull()
    })

    test('a split payment lists every method with its own amount', () => {
        const split: OrderDetail = {
            ...baseOrder,
            payments: [
                {
                    id: 'pay-1',
                    order_id: 'order-1',
                    payment_method: 'cash',
                    amount: 100,
                    reference_number: null,
                    notes: null,
                    created_at: '2026-09-21T15:30:00Z'
                },
                {
                    id: 'pay-2',
                    order_id: 'order-1',
                    payment_method: 'card',
                    amount: 41,
                    reference_number: null,
                    notes: null,
                    created_at: '2026-09-21T15:30:00Z'
                }
            ]
        }
        render(
            <IntlProvider>
                <ReceiptTicket order={split} settings={testSettings} />
            </IntlProvider>
        )
        // Scoped: the tax breakdown's "Base" column happens to also show $100.00 for this fixture's items.
        const payments = within(screen.getByTestId('receipt-payments'))
        expect(payments.getByText('Cash')).toBeTruthy()
        expect(payments.getByText('$100.00')).toBeTruthy()
        expect(payments.getByText('Card')).toBeTruthy()
        expect(payments.getByText('$41.00')).toBeTruthy()
    })

    test('shows a walk-in fallback when there is no customer', () => {
        render(
            <IntlProvider>
                <ReceiptTicket order={baseOrder} settings={testSettings} />
            </IntlProvider>
        )
        expect(screen.getByText(/Walk-in Customer/)).toBeTruthy()
    })

    test('names the customer when there is one', () => {
        render(
            <IntlProvider>
                <ReceiptTicket
                    order={{ ...baseOrder, customer: { id: 'c-1', name: 'Maria Lopez', email: null, phone: null } }}
                    settings={testSettings}
                />
            </IntlProvider>
        )
        expect(screen.getByText(/Maria Lopez/)).toBeTruthy()
    })

    test('shows the REFUNDED stamp for a refunded order', () => {
        render(
            <IntlProvider>
                <ReceiptTicket order={{ ...baseOrder, status: 'refunded' }} settings={testSettings} />
            </IntlProvider>
        )
        expect(screen.getByText('REFUNDED')).toBeTruthy()
    })

    test('prints the store logo in the header when one is uploaded', () => {
        const logoUrl = 'https://acct.r2.cloudflarestorage.com/bucket/settings/logo.webp?X-Amz-Signature=abc'
        render(
            <IntlProvider>
                <ReceiptTicket order={baseOrder} settings={{ ...testSettings, store_logo_url: logoUrl }} />
            </IntlProvider>
        )
        const logo = screen.getByTestId('receipt-logo')
        expect(logo.getAttribute('src')).toBe(logoUrl)
    })

    test('renders no logo image when none is uploaded', () => {
        render(
            <IntlProvider>
                <ReceiptTicket order={baseOrder} settings={testSettings} />
            </IntlProvider>
        )
        expect(screen.queryByTestId('receipt-logo')).toBeNull()
        expect(screen.getByTestId('receipt-ticket').querySelector('img')).toBeNull()
    })
})
