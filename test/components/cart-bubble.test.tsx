import { afterEach, describe, expect, mock, test } from 'bun:test'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')

const { CartBubble } = await import('@/components/pos/cart-bubble')
const { SessionProvider } = await import('@/components/session-provider')

const renderBubble = (props: Partial<Parameters<typeof CartBubble>[0]> = {}) => {
    const onClick = mock(() => {})
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <CartBubble itemCount={0} total={0} lines={[]} hasProblem={false} onClick={onClick} {...props} />
            </SessionProvider>
        </IntlProvider>
    )
    return onClick
}

afterEach(cleanup)

describe('CartBubble', () => {
    test('is hidden while the cart is empty and there are no open tabs', () => {
        renderBubble()
        expect(screen.queryByRole('button')).toBeNull()
    })

    test('shows the item count and the preview total, and opens the sheet on click', () => {
        const onClick = renderBubble({ itemCount: 2, total: 80.27 })
        const button = screen.getByRole('button', { name: 'Cart: 2 items, total $80.27' })
        expect(button.textContent).toContain('$80.27')
        fireEvent.click(button)
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    test('turns red when a line has a problem', () => {
        renderBubble({ itemCount: 1, total: 5, hasProblem: true })
        expect(screen.getByRole('button').className).toContain('bg-red-600')
    })

    test('stays visible for an empty cart when there are open tabs to show', () => {
        renderBubble({ itemCount: 0, openTabsLabel: '2 open tabs' })
        expect(screen.getByText('2 open tabs')).toBeTruthy()
    })
})
