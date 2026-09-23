import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
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
const createSale = mock(async (_body: unknown, _idempotencyKey?: string) => ({
    id: 'order-1',
    order_number: 'ORD-260921-000001',
    total: 80.27
}))
const push = mock(() => {})

void mock.module('@/lib/api/products', () => ({ productsApi: { list, top: async () => [] } }))
void mock.module('@/lib/api/promotions', () => ({
    promotionsApi: { list: async () => page([]) }
}))
void mock.module('@/lib/api/categories', () => ({ categoriesApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/customers', () => ({ customersApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/orders', () => ({ salesApi: { create: createSale } }))
void mock.module('@/lib/api/tabs', () => ({
    tabsApi: {
        list: async () => page([]),
        open: async () => ({ id: 't-1', tab_number: 'TAB-000001' }),
        addItems: async () => ({ id: 't-1', tab_number: 'TAB-000001' })
    }
}))
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

const addToCart = (name: string, qty = 1) => {
    fireEvent.click(screen.getByRole('button', { name: `Add ${name} to cart` }))
    for (let i = 1; i < qty; i++) {
        fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
}
const openCart = () => fireEvent.click(screen.getByRole('button', { name: /^Cart:/ }))
// Scoped to the cart dialog: the bubble's own hover preview repeats "Total", so an unscoped query is ambiguous.
const cartDialog = () => screen.getByRole('dialog', { name: /^Cart/ })
const cartSummary = (label: string) =>
    within(cartDialog()).getByText(label, { selector: 'span' }).parentElement?.textContent ?? ''

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

        fireEvent.click(screen.getByRole('button', { name: 'Add Sold Out Thing to cart' }))
        expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
        expect(useCartStore.getState().items).toEqual([])
        // Nothing was added: the cart bubble stays visible but still reports an empty cart.
        expect(screen.getByRole('button', { name: 'Cart: 0 items, total $0.00' })).toBeTruthy()
    })

    test('adds products, merges repeats into one line and shows a preview of the totals', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        addToCart('Wireless Mouse')
        addToCart('USB-C Cable')

        await waitFor(() => expect(screen.getByRole('button', { name: /^Cart:/ })).toBeTruthy())
        openCart()
        expect(await screen.findByText('Cart (2)')).toBeTruthy()
        expect(useCartStore.getState().items).toEqual([
            { kind: 'product', productId: 'p-mouse', quantity: 2, discount: 0 },
            { kind: 'product', productId: 'p-cable', quantity: 1, discount: 0 }
        ])
        // 2 x 29.99 + 12.99 = 72.97; 10 % tax per line = 6.00 + 1.30
        await waitFor(() => expect(cartSummary('Subtotal')).toContain('$72.97'))
        expect(cartSummary('Tax')).toContain('$7.30')
        expect(cartSummary('Total')).toContain('$80.27')
        expect(screen.getByText(/Estimate\./)).toBeTruthy()
    })

    test('confirming a quantity N adds that many units in one step', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse', 3)
        await waitFor(() =>
            expect(useCartStore.getState().items).toEqual([
                { kind: 'product', productId: 'p-mouse', quantity: 3, discount: 0 }
            ])
        )
    })

    test('decreasing pending qty to 0 dismisses the stepper without adding to the cart', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: 'Add Wireless Mouse to cart' }))
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
        expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
        expect(useCartStore.getState().items).toEqual([])
    })

    test('opening another product discards the previous pending quantity without confirming', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: 'Add Wireless Mouse to cart' }))
        fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
        fireEvent.click(screen.getByRole('button', { name: 'Add USB-C Cable to cart' }))
        // Only the cable stepper is open; mouse draft was discarded.
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        await waitFor(() =>
            expect(useCartStore.getState().items).toEqual([
                { kind: 'product', productId: 'p-cable', quantity: 1, discount: 0 }
            ])
        )
    })

    test('+ is capped at stock minus units already in the cart', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse', 2) // stock 3 → 1 left addable
        fireEvent.click(screen.getByRole('button', { name: 'Add Wireless Mouse to cart' }))
        const increase = () => screen.getByRole('button', { name: 'Increase quantity' }) as HTMLButtonElement
        expect(increase().disabled).toBe(true) // pending qty starts at 1 = maxAddable
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        await waitFor(() => expect(useCartStore.getState().items[0]?.quantity).toBe(3))
    })

    test('changes quantity with the buttons, never beyond the stock, and removes a line', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        const increase = () => screen.getByRole('button', { name: 'Increase quantity' })

        fireEvent.click(increase())
        fireEvent.click(increase())
        await waitFor(() => expect(useCartStore.getState().items[0]?.quantity).toBe(3))
        expect((increase() as HTMLButtonElement).disabled).toBe(true) // only 3 in stock

        fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
        await waitFor(() => expect(useCartStore.getState().items[0]?.quantity).toBe(2))

        fireEvent.click(screen.getByRole('button', { name: 'Remove from cart' }))
        expect(useCartStore.getState().items).toEqual([])
    })

    test('decreasing the last unit removes the line', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('USB-C Cable')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        fireEvent.click(await screen.findByRole('button', { name: 'Decrease quantity' }))
        expect(useCartStore.getState().items).toEqual([])
    })

    test('the order discount is applied after tax in the preview', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('USB-C Cable') // 12.99 + 1.30 tax = 14.29
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        await screen.findByText('Cart (1)')
        fireEvent.change(screen.getByLabelText('Discount'), { target: { value: '4' } })
        await waitFor(() => expect(cartSummary('Total')).toContain('$10.29'))
        expect(useCartStore.getState().discount).toBe(4)
    })

    test('a cart restored from a previous visit is priced from live data; lines that cannot be sold block checkout', async () => {
        useCartStore.setState({
            items: [
                { kind: 'product', productId: 'p-gone', quantity: 1, discount: 0 }, // sold out since
                { kind: 'product', productId: 'p-deleted', quantity: 1, discount: 0 }, // deleted since
                { kind: 'product', productId: 'p-cable', quantity: 1, discount: 0 }
            ]
        })
        renderPos()
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        expect(await screen.findByText('Only 0 in stock')).toBeTruthy()
        expect(await screen.findByText('No longer available')).toBeTruthy()
        const checkout = () => screen.getByRole('button', { name: /Checkout/ }) as HTMLButtonElement
        expect(checkout().disabled).toBe(true)
        // The live lookup asked for exactly the products in the cart.
        expect(list.mock.calls.some(([query]) => query.ids === 'p-cable,p-deleted,p-gone')).toBe(true)

        const removeButtons = screen.getAllByRole('button', { name: 'Remove from cart' })
        fireEvent.click(removeButtons[0] as HTMLElement)
        fireEvent.click(screen.getAllByRole('button', { name: 'Remove from cart' })[0] as HTMLElement)
        await waitFor(() =>
            expect(
                useCartStore.getState().items.map(item => (item.kind === 'product' ? item.productId : item.promotionId))
            ).toEqual(['p-cable'])
        )
        await waitFor(() => expect(checkout().disabled).toBe(false))
    })

    test('checkout sends ids and quantities only, then empties the cart and shows the server total', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))

        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(dialog).getByRole('button', { name: /Card/ }))
        fireEvent.click(within(dialog).getByRole('button', { name: 'Complete Order' }))

        await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1))
        expect(createSale.mock.calls[0]).toEqual([
            {
                customer_id: null,
                payment_method: 'card',
                items: [{ product_id: 'p-mouse', quantity: 2, discount: 0 }],
                discount: 0
            },
            expect.any(String) // idempotency key: one per checkout attempt, see app/(dashboard)/pos/page.tsx
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
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Complete Order' }))

        await waitFor(() => expect(createSale).toHaveBeenCalled())
        await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(2)) // refreshed stock after the failure
        expect(useCartStore.getState().items).toHaveLength(1)
    })

    test('retrying the same checkout attempt reuses the idempotency key', async () => {
        createSale.mockImplementationOnce(async () => {
            throw new Error('network_offline')
        })
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        const submit = () => within(dialog).getByRole('button', { name: 'Complete Order' })
        fireEvent.click(submit())
        await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1))
        fireEvent.click(submit())
        await waitFor(() => expect(createSale).toHaveBeenCalledTimes(2))

        const [firstKey] = createSale.mock.calls[0]?.slice(1) ?? []
        const [secondKey] = createSale.mock.calls[1]?.slice(1) ?? []
        expect(firstKey).toBe(secondKey)
    })
})
