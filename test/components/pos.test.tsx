import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { product, page, settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react')

const mouse = product({
    id: 'p-mouse',
    name: 'Wireless Mouse',
    sku: 'ELEC-001',
    selling_price: 29.99,
    tax_rate: 0.1,
    stock: 3
})
const cable = product({
    id: 'p-cable',
    name: 'USB-C Cable',
    sku: 'ELEC-002',
    selling_price: 12.99,
    tax_rate: 0.1,
    stock: 10
})
const gone = product({ id: 'p-gone', name: 'Sold Out Thing', sku: 'GONE-1', selling_price: 5, stock: 0 })
const catalog = [mouse, cable, gone]

const list = mock(async (query: Record<string, unknown>) => {
    const ids = typeof query.ids === 'string' ? query.ids.split(',') : null
    return page(ids ? catalog.filter(item => ids.includes(item.id)) : catalog)
})
const createSale = mock(async (_body: unknown) => ({ id: 'order-1', order_number: 'ORD-260921-000001', total: 80.27 }))
const push = mock(() => {})

void mock.module('@/lib/api/products', () => ({ productsApi: { list } }))
void mock.module('@/lib/api/categories', () => ({ categoriesApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/customers', () => ({ customersApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/orders', () => ({ salesApi: { create: createSale } }))
void mock.module('next/navigation', () => ({
    useRouter: () => ({ push, refresh: () => {} }),
    usePathname: () => '/pos'
}))

const { default: POSPage } = await import('@/app/(dashboard)/pos/page')
const { SessionProvider } = await import('@/components/session-provider')
const { useCartStore } = await import('@/stores/cart')

const renderPos = () =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <POSPage />
            </SessionProvider>
        </IntlProvider>
    )

const addToCart = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Add ${name} to cart` }))
const cartSummary = (label: string) => screen.getByText(label, { selector: 'span' }).parentElement?.textContent ?? ''

beforeAll(() => {
    // The store is a singleton and persists to localStorage: start every test from an empty cart.
})
beforeEach(() => {
    useCartStore.getState().clearCart()
    list.mockClear()
    createSale.mockClear()
})
afterEach(cleanup)

describe('POS cart', () => {
    test('lists the catalog with stock and marks sold-out products as not addable', async () => {
        renderPos()
        expect(await screen.findByText('Wireless Mouse')).toBeTruthy()
        expect(screen.getByText('3 left')).toBeTruthy()
        expect(screen.getByText('Out of stock')).toBeTruthy()

        addToCart('Sold Out Thing')
        expect(useCartStore.getState().items).toEqual([])
        expect(screen.getByText('Cart is empty')).toBeTruthy()
    })

    test('adds products, merges repeats into one line and shows a preview of the totals', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        addToCart('Wireless Mouse')
        addToCart('USB-C Cable')

        expect(await screen.findByText('Cart (2)')).toBeTruthy()
        expect(useCartStore.getState().items).toEqual([
            { productId: 'p-mouse', quantity: 2, discount: 0 },
            { productId: 'p-cable', quantity: 1, discount: 0 }
        ])
        // 2 x 29.99 + 12.99 = 72.97; 10 % tax per line = 6.00 + 1.30
        await waitFor(() => expect(cartSummary('Subtotal')).toContain('$72.97'))
        expect(cartSummary('Tax')).toContain('$7.30')
        expect(cartSummary('Total')).toContain('$80.27')
        expect(screen.getByText(/Estimate\./)).toBeTruthy()
    })

    test('changes quantity with the buttons, never beyond the stock, and removes a line', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        const increase = () => screen.getByRole('button', { name: 'Increase quantity' })

        fireEvent.click(increase())
        fireEvent.click(increase())
        await waitFor(() => expect(useCartStore.getState().items[0]?.quantity).toBe(3))
        expect((increase() as HTMLButtonElement).disabled).toBe(true) // only 3 in stock

        fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
        await waitFor(() => expect(useCartStore.getState().items[0]?.quantity).toBe(2))

        fireEvent.click(screen.getByRole('button', { name: 'Remove from cart' }))
        expect(useCartStore.getState().items).toEqual([])
        expect(await screen.findByText('Cart is empty')).toBeTruthy()
    })

    test('decreasing the last unit removes the line', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('USB-C Cable')
        fireEvent.click(await screen.findByRole('button', { name: 'Decrease quantity' }))
        expect(useCartStore.getState().items).toEqual([])
    })

    test('the order discount is applied after tax in the preview', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('USB-C Cable') // 12.99 + 1.30 tax = 14.29
        await screen.findByText('Cart (1)')
        fireEvent.change(screen.getByLabelText('Discount'), { target: { value: '4' } })
        await waitFor(() => expect(cartSummary('Total')).toContain('$10.29'))
        expect(useCartStore.getState().discount).toBe(4)
    })

    test('a cart restored from a previous visit is priced from live data; lines that cannot be sold block checkout', async () => {
        useCartStore.setState({
            items: [
                { productId: 'p-gone', quantity: 1, discount: 0 }, // sold out since
                { productId: 'p-deleted', quantity: 1, discount: 0 }, // deleted since: the lookup does not return it
                { productId: 'p-cable', quantity: 1, discount: 0 }
            ]
        })
        renderPos()
        expect(await screen.findByText('Only 0 in stock')).toBeTruthy()
        expect(await screen.findByText('No longer available')).toBeTruthy()
        expect(screen.queryByText('Loading…')).toBeNull()
        const checkout = () => screen.getByRole('button', { name: /Checkout/ }) as HTMLButtonElement
        expect(checkout().disabled).toBe(true)
        // The live lookup asked for exactly the products in the cart.
        expect(list.mock.calls.some(([query]) => query.ids === 'p-cable,p-deleted,p-gone')).toBe(true)

        const removeButtons = screen.getAllByRole('button', { name: 'Remove from cart' })
        fireEvent.click(removeButtons[0] as HTMLElement)
        fireEvent.click(screen.getAllByRole('button', { name: 'Remove from cart' })[0] as HTMLElement)
        await waitFor(() => expect(useCartStore.getState().items.map(item => item.productId)).toEqual(['p-cable']))
        await waitFor(() => expect(checkout().disabled).toBe(false))
    })

    test('checkout sends ids and quantities only, then empties the cart and shows the server total', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        addToCart('Wireless Mouse')
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))

        const dialog = await screen.findByRole('dialog')
        fireEvent.click(within(dialog).getByRole('button', { name: /Card/ }))
        fireEvent.click(within(dialog).getByRole('button', { name: 'Complete Order' }))

        await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1))
        expect(createSale.mock.calls[0]).toEqual([
            {
                customer_id: null,
                payment_method: 'card',
                items: [{ product_id: 'p-mouse', quantity: 2, discount: 0 }],
                discount: 0
            }
        ])
        // Nothing but ids and quantities: no prices, tax or totals travel to the server.
        expect(JSON.stringify(createSale.mock.calls[0])).not.toMatch(/29\.99|unit_price|total|tax/)
        await waitFor(() => expect(useCartStore.getState().items).toEqual([]))
    })

    test('a failed sale keeps the cart so the cashier can fix it', async () => {
        createSale.mockImplementationOnce(async () => {
            throw new Error('Insufficient stock for "Wireless Mouse"')
        })
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Complete Order' }))

        await waitFor(() => expect(createSale).toHaveBeenCalled())
        await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(2)) // refreshed stock after the failure
        expect(useCartStore.getState().items).toHaveLength(1)
    })
})
