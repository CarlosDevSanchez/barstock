import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { product, page, settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react')

// 20 loose cigarettes on the shelf; the box of 15 sells from the same units; coffee is never counted.
const single = product({ id: 'p-single', name: 'Cigarette', sku: 'CIG-1', selling_price: 2, stock: 20 })
const box = product({
    id: 'p-box',
    name: 'Cigarette box x15',
    sku: 'CIG-15',
    selling_price: 10,
    stock: 1,
    stock_mode: 'linked',
    stock_product_id: 'p-single',
    stock_units: 15,
    stock_base_quantity: 20,
    stock_base: { id: 'p-single', name: 'Cigarette' }
})
const coffee = product({
    id: 'p-coffee',
    name: 'Coffee',
    sku: 'COF-1',
    selling_price: 3,
    stock: null,
    stock_mode: 'none',
    stock_base_quantity: null
})
const catalog = [single, box, coffee]

const list = mock(async (query: Record<string, unknown>) => {
    const ids = typeof query.ids === 'string' ? query.ids.split(',') : null
    return page(ids ? catalog.filter(item => ids.includes(item.id)) : catalog)
})

void mock.module('@/lib/api/products', () => ({ productsApi: { list, top: async () => [] } }))
void mock.module('@/lib/api/pos', () => ({
    posApi: {
        snapshot: async () => ({
            generated_at: new Date().toISOString(),
            products: catalog,
            promotions: [],
            categories: [],
            customers: []
        })
    }
}))
void mock.module('@/lib/api/promotions', () => ({ promotionsApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/categories', () => ({ categoriesApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/customers', () => ({ customersApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/orders', () => ({ salesApi: { create: async () => ({}) }, ordersApi: {} }))
void mock.module('@/lib/api/cash', () => ({
    cashApi: {
        current: async () => ({
            day: { id: 'day-1' },
            sessions: [{ users: [{ id: 'user-cashier' }] }],
            registers: [],
            staff: [],
            default_opening_float: 0
        })
    }
}))
void mock.module('@/lib/api/tabs', () => ({ tabsApi: { list: async () => page([]) } }))
void mock.module('next/navigation', () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    usePathname: () => '/pos'
}))

const { default: POSPage } = await import('@/app/(dashboard)/pos/page')
const { SessionProvider } = await import('@/components/session-provider')
const { useCartStore } = await import('@/stores/cart')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const renderPos = () =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <TooltipProvider>
                    <POSPage />
                </TooltipProvider>
            </SessionProvider>
        </IntlProvider>
    )

const addToCart = (name: string, qty = 1) => {
    fireEvent.click(screen.getByRole('button', { name: `Add ${name} to cart` }))
    for (let i = 1; i < qty; i++) {
        fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
}
const isDisabled = (name: string) =>
    screen.getByRole('button', { name: `Add ${name} to cart` }).getAttribute('aria-disabled') === 'true'

beforeEach(() => {
    useCartStore.getState().clearCart()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(cleanup)

describe('POS with stock modes', () => {
    test('an untracked product is always available and has no cap', async () => {
        renderPos()
        await screen.findByText('Coffee')
        expect(screen.getAllByText('Always available').length).toBeGreaterThan(0)

        addToCart('Coffee', 40)
        await waitFor(() => expect(useCartStore.getState().items[0]).toMatchObject({ productId: 'p-coffee' }))
        expect(useCartStore.getState().items[0]?.quantity).toBe(40)
    })

    test('a box and loose singles share the base: 6 singles leave no room for a box of 15', async () => {
        renderPos()
        await screen.findByText('Cigarette box x15')
        expect(isDisabled('Cigarette box x15')).toBe(false)

        addToCart('Cigarette', 6)
        await waitFor(() => expect(useCartStore.getState().items[0]?.quantity).toBe(6))
        await waitFor(() => expect(isDisabled('Cigarette box x15')).toBe(true))
    })

    test('with a box in the cart, only 5 more singles fit', async () => {
        renderPos()
        await screen.findByText('Cigarette box x15')
        addToCart('Cigarette box x15')
        await waitFor(() => expect(useCartStore.getState().items).toHaveLength(1))

        fireEvent.click(screen.getByRole('button', { name: 'Add Cigarette to cart' }))
        const increase = () => screen.getByRole('button', { name: 'Increase quantity' }) as HTMLButtonElement
        for (let i = 1; i < 5; i++) fireEvent.click(increase())
        expect(increase().disabled).toBe(true)
    })
})
