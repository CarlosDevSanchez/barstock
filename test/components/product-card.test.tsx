import { afterEach, describe, expect, mock, test } from 'bun:test'
import { product, settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')

const { ProductCard } = await import('@/components/pos/product-card')
const { SessionProvider } = await import('@/components/session-provider')

const renderCard = (overrides: Parameters<typeof product>[0] = {}, onAdd = mock(() => {})) => {
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <ProductCard product={product(overrides)} onAdd={onAdd} />
            </SessionProvider>
        </IntlProvider>
    )
    return onAdd
}

afterEach(cleanup)

describe('ProductCard', () => {
    test('shows the price and the stock badge on their own rows, and calls onAdd when clicked', () => {
        const onAdd = renderCard({ id: 'p-1', name: 'Wireless Mouse', selling_price: 29.99, stock: 3 })
        expect(screen.getByText('$29.99')).toBeTruthy()
        expect(screen.getByText('3 left')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Add Wireless Mouse to cart' }))
        expect(onAdd).toHaveBeenCalledWith('p-1')
    })

    test('a long name and a long category both wrap instead of breaking the layout, and stay in the badge row', () => {
        renderCard({
            name: 'An Extremely Long Product Name That Would Otherwise Overflow The Compact Card Layout',
            category: { id: 'c-1', name: 'A Very Long Category Name That Should Truncate Gracefully' },
            stock: 5
        })
        expect(screen.getByText('A Very Long Category Name That Should Truncate Gracefully').className).toContain(
            'truncate'
        )
        expect(screen.getByText('5 left').closest('div')?.className).toContain('flex-wrap')
    })

    test('a sold-out product is not addable', () => {
        const onAdd = renderCard({ name: 'Gone', stock: 0 })
        expect(screen.getByText('Out of stock')).toBeTruthy()
        const card = screen.getByRole('button', { name: 'Add Gone to cart' })
        expect(card.getAttribute('aria-disabled')).toBe('true')
        fireEvent.click(card)
        expect(onAdd).not.toHaveBeenCalled()
    })
})
