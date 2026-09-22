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

const renderTop = (onAdd = mock(() => {})) => {
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <TopProducts reloadSignal={0} onAdd={onAdd} />
            </SessionProvider>
        </IntlProvider>
    )
    return onAdd
}

afterEach(cleanup)

describe('TopProducts', () => {
    test('shows the best sellers with price and units sold, and adds one on click', async () => {
        const onAdd = renderTop()
        expect(await screen.findByText('Best sellers (30 days)')).toBeTruthy()
        expect(screen.getByText('Beer')).toBeTruthy()
        expect(screen.getByText('$8.50')).toBeTruthy()
        expect(screen.getByText('42 sold')).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Add Beer to cart' }))
        expect(onAdd).toHaveBeenCalledWith('p-1')
    })

    test('a sold-out best seller is not addable', async () => {
        const onAdd = renderTop()
        await screen.findByText('Chips')
        const chip = screen.getByRole('button', { name: 'Add Chips to cart' }) as HTMLButtonElement
        expect(chip.disabled).toBe(true)
        fireEvent.click(chip)
        expect(onAdd).not.toHaveBeenCalled()
    })

    test('renders nothing when there is no sales history yet', async () => {
        top.mockImplementationOnce(async () => [])
        const { container } = render(
            <IntlProvider>
                <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                    <TopProducts reloadSignal={0} onAdd={() => {}} />
                </SessionProvider>
            </IntlProvider>
        )
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(container.textContent).toBe('')
    })
})
