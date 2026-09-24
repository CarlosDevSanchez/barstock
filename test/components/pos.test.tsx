import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { product, page, settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react')

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
    let items = ids ? catalog.filter(item => ids.includes(item.id)) : catalog
    // Live search sends `q`; without this the online path ignores the needle and the offline-browsing
    // assertion waits on debounce alone — on a slow CI runner that can burn the whole 5s test budget.
    if (typeof query.q === 'string' && query.q.trim()) {
        const needle = query.q.trim().toLowerCase()
        items = items.filter(
            item =>
                item.name.toLowerCase().includes(needle) ||
                item.sku.toLowerCase().includes(needle) ||
                (item.barcode?.toLowerCase().includes(needle) ?? false)
        )
    }
    return page(items)
})
const completedOrder = {
    id: 'order-1',
    order_number: 'ORD-260921-000001',
    customer_id: null,
    status: 'completed' as const,
    subtotal: 72.97,
    discount: 0,
    tax: 7.3,
    total: 80.27,
    notes: null,
    tab_id: null,
    created_by: 'user-1',
    created_at: '2026-09-21T15:30:00Z',
    updated_at: '2026-09-21T15:30:00Z',
    refunded_at: null,
    refunded_by: null,
    refund_reason: null,
    client_ref: null,
    occurred_at: null,
    source: 'online' as const,
    sync_issues: null,
    reviewed_by: null,
    reviewed_at: null,
    customer: null,
    created_by_name: 'Jane Cashier',
    tab: null,
    items: [],
    payments: [{ id: 'pay-1', payment_method: 'card' as const, amount: 80.27 }]
}
const createSale = mock(async (_body: unknown, _idempotencyKey?: string) => completedOrder)
const push = mock(() => {})
const snapshot = mock(async () => ({
    generated_at: new Date().toISOString(),
    products: catalog,
    promotions: [],
    categories: [],
    customers: []
}))

void mock.module('@/lib/api/products', () => ({ productsApi: { list, top: async () => [] } }))
void mock.module('@/lib/api/pos', () => ({ posApi: { snapshot } }))
void mock.module('@/lib/api/promotions', () => ({
    promotionsApi: { list: async () => page([]) }
}))
void mock.module('@/lib/api/categories', () => ({ categoriesApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/customers', () => ({ customersApi: { list: async () => page([]) } }))
void mock.module('@/lib/api/orders', () => ({
    salesApi: { create: createSale },
    ordersApi: { get: async () => completedOrder }
}))
const cashDesk = {
    day: { id: 'day-1' } as { id: string } | null,
    sessions: [{ users: [{ id: 'user-cashier' }] }] as { users: { id: string }[] }[]
}
void mock.module('@/lib/api/cash', () => ({
    cashApi: {
        current: async () => ({
            day: cashDesk.day,
            sessions: cashDesk.sessions,
            registers: [],
            staff: [],
            default_opening_float: 0
        })
    }
}))
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
const openCart = () => fireEvent.click(screen.getByRole('button', { name: /^Cart:/ }))
const setOnline = (value: boolean) => {
    Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}
// Scoped to the cart dialog: the bubble's own hover preview repeats "Total", so an unscoped query is ambiguous.
const cartDialog = () => screen.getByRole('dialog', { name: /^Cart/ })
const cartSummary = (label: string) =>
    within(cartDialog()).getByText(label, { selector: 'span' }).parentElement?.textContent ?? ''

beforeEach(() => {
    cashDesk.day = { id: 'day-1' }
    cashDesk.sessions = [{ users: [{ id: 'user-cashier' }] }]
    useCartStore.getState().clearCart()
    list.mockClear()
    createSale.mockClear()
    snapshot.mockClear()
    setOnline(true)
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

    test('closing and reopening the payment dialog after a failed attempt still reuses the same key: a lost response cannot be double-charged by "cancel, try again"', async () => {
        createSale.mockImplementationOnce(async () => {
            throw new Error('network_offline')
        })
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
        const firstDialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(firstDialog).getByRole('button', { name: 'Complete Order' }))
        await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1))

        // Cancel the failed attempt's dialog, then reopen it (the cart itself was never touched).
        fireEvent.click(within(firstDialog).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Complete Payment' })).toBeNull())
        fireEvent.click(screen.getByRole('button', { name: /Checkout/ }))
        const secondDialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(secondDialog).getByRole('button', { name: 'Complete Order' }))
        await waitFor(() => expect(createSale).toHaveBeenCalledTimes(2))

        const [firstKey] = createSale.mock.calls[0]?.slice(1) ?? []
        const [secondKey] = createSale.mock.calls[1]?.slice(1) ?? []
        expect(firstKey).toBe(secondKey)
    })

    test('browsing keeps working offline from the last snapshot, search and category filter included', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        await waitFor(() => expect(snapshot).toHaveBeenCalled())

        act(() => {
            setOnline(false)
            window.dispatchEvent(new Event('offline'))
        })

        // Still there, from the snapshot fetched while online, not from the (now failing) live list.
        expect(screen.getByText('Wireless Mouse')).toBeTruthy()
        expect(screen.getByText('USB-C Cable')).toBeTruthy()

        fireEvent.change(screen.getByPlaceholderText('Search by name, SKU, or barcode...'), {
            target: { value: 'cable' }
        })
        // useDebouncedValue defaults to 300ms; wait past it once instead of polling up to 3s (that alone
        // burned most of bun's 5s per-test budget on CI).
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 350))
        })
        expect(screen.queryByText('Wireless Mouse')).toBeNull()
        expect(screen.getByText('USB-C Cable')).toBeTruthy()
    })

    test('checkout queues the sale offline instead of calling the server, and still empties the cart', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        await waitFor(() => expect(snapshot).toHaveBeenCalled())
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))

        act(() => {
            setOnline(false)
            window.dispatchEvent(new Event('offline'))
        })

        openCart()
        const checkoutButton = await screen.findByRole('button', { name: /Checkout/ })
        expect((checkoutButton as HTMLButtonElement).disabled).toBe(false) // the offline window hasn't expired
        fireEvent.click(checkoutButton)
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Complete Order' }))

        await waitFor(() => expect(useCartStore.getState().items).toEqual([]))
        expect(createSale).not.toHaveBeenCalled()
    })

    test('checkout is blocked once the offline window has expired, with an explanation', async () => {
        snapshot.mockImplementationOnce(async () => ({
            generated_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), // settings.offline_max_hours is 12
            products: catalog,
            promotions: [],
            categories: [],
            customers: []
        }))
        renderPos()
        await screen.findByText('Wireless Mouse')
        await waitFor(() => expect(snapshot).toHaveBeenCalled())
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))

        act(() => {
            setOnline(false)
            window.dispatchEvent(new Event('offline'))
        })
        openCart()

        await waitFor(() =>
            expect((screen.getByRole('button', { name: /Checkout/ }) as HTMLButtonElement).disabled).toBe(true)
        )
        expect(createSale).not.toHaveBeenCalled()
    })

    test('split payment shows the gap and disables checkout until the amounts match', async () => {
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Split payment' }))

        const first = within(dialog).getByRole('spinbutton', { name: 'Payment Method Amount' })
        const second = within(dialog).getByRole('spinbutton', { name: 'Second payment Amount' })
        fireEvent.change(first, { target: { value: '10' } })
        await waitFor(() => expect((second as HTMLInputElement).value).toBe('22.99'))
        expect((within(dialog).getByRole('button', { name: 'Complete Order' }) as HTMLButtonElement).disabled).toBe(
            false
        )

        fireEvent.change(second, { target: { value: '1' } })
        expect(within(dialog).getByText(/Short/)).toBeTruthy()
        expect((within(dialog).getByRole('button', { name: 'Complete Order' }) as HTMLButtonElement).disabled).toBe(
            true
        )

        fireEvent.change(second, { target: { value: '100' } })
        expect(within(dialog).getByText(/Over by/)).toBeTruthy()

        fireEvent.change(within(dialog).getByLabelText('Received'), { target: { value: '50' } })
        expect(within(dialog).getByText('Change').parentElement?.textContent).toMatch(/40/)
    })

    test('a completed sale offers print, the order and a new sale', async () => {
        const print = mock(() => {})
        window.print = print
        renderPos()
        await screen.findByText('Wireless Mouse')
        addToCart('Wireless Mouse')
        await waitFor(() => screen.getByRole('button', { name: /^Cart:/ }))
        openCart()
        fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
        fireEvent.click(
            within(await screen.findByRole('dialog', { name: 'Complete Payment' })).getByRole('button', {
                name: 'Complete Order'
            })
        )

        const done = await screen.findByRole('dialog', { name: 'Sale completed' })
        expect(within(done).getByText('ORD-260921-000001', { exact: false })).toBeTruthy()
        fireEvent.click(within(done).getByRole('button', { name: 'Print' }))
        expect(print).toHaveBeenCalled()
        fireEvent.click(within(done).getByRole('button', { name: 'New sale' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sale completed' })).toBeNull())
    })

    test('a missing business day is a notice and does not block the catalog', async () => {
        cashDesk.day = null
        renderPos()
        expect(await screen.findByText('No business day is open')).toBeTruthy()
        expect(await screen.findByText('Wireless Mouse')).toBeTruthy()
    })
})
