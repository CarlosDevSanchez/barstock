import { afterEach, describe, expect, mock, test } from 'bun:test'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')

const topProducts = [
    { product_id: 'p-1', name: 'Beer', selling_price: 8.5, stock: 20, category_name: 'Drinks', quantity: 42 },
    { product_id: 'p-2', name: 'Chips', selling_price: 3.2, stock: 0, category_name: null, quantity: 10 }
]
const top = mock(async () => topProducts)
void mock.module('@/lib/api/products', () => ({ productsApi: { top } }))

const { TopProducts } = await import('@/components/pos/top-products')
const { SessionProvider } = await import('@/components/session-provider')

const idleProps = {
    pendingId: null as string | null,
    pendingQty: 1,
    qtyInCart: () => 0
}

const renderTop = (
    onSelect = mock(() => {}),
    extras: Partial<{
        pendingId: string | null
        pendingQty: number
        onChangeQty: ReturnType<typeof mock>
        onConfirm: ReturnType<typeof mock>
    }> = {}
) => {
    const onChangeQty = extras.onChangeQty ?? mock(() => {})
    const onConfirm = extras.onConfirm ?? mock(() => {})
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <TopProducts
                    reloadSignal={0}
                    pendingId={extras.pendingId ?? idleProps.pendingId}
                    pendingQty={extras.pendingQty ?? idleProps.pendingQty}
                    qtyInCart={idleProps.qtyInCart}
                    onSelect={onSelect}
                    onChangeQty={onChangeQty}
                    onConfirm={onConfirm}
                />
            </SessionProvider>
        </IntlProvider>
    )
    return { onSelect, onChangeQty, onConfirm }
}

afterEach(cleanup)

describe('TopProducts', () => {
    test('shows the best sellers with price and units sold, and selects one on click', async () => {
        const { onSelect } = renderTop()
        expect(await screen.findByText('Best sellers (30 days)')).toBeTruthy()
        expect(screen.getByText('Beer')).toBeTruthy()
        expect(screen.getByText('$8.50')).toBeTruthy()
        expect(screen.getByText('42 sold')).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Add Beer to cart' }))
        expect(onSelect).toHaveBeenCalledWith('p-1')
    })

    test('a sold-out best seller is not addable', async () => {
        const { onSelect } = renderTop()
        await screen.findByText('Chips')
        const chip = screen.getByRole('button', { name: 'Add Chips to cart' })
        expect(chip.getAttribute('aria-disabled')).toBe('true')
        fireEvent.click(chip)
        expect(onSelect).not.toHaveBeenCalled()
    })

    test('pending overlay confirms via onConfirm', async () => {
        const { onConfirm } = renderTop(
            mock(() => {}),
            { pendingId: 'p-1', pendingQty: 2 }
        )
        expect(await screen.findByRole('button', { name: 'Confirm' })).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    test('renders nothing when there is no sales history yet', async () => {
        top.mockImplementationOnce(async () => [])
        const { container } = render(
            <IntlProvider>
                <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                    <TopProducts
                        reloadSignal={0}
                        pendingId={null}
                        pendingQty={1}
                        qtyInCart={() => 0}
                        onSelect={() => {}}
                        onChangeQty={() => {}}
                        onConfirm={() => {}}
                    />
                </SessionProvider>
            </IntlProvider>
        )
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(container.textContent).toBe('')
    })
})
