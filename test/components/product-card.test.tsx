import { afterEach, describe, expect, mock, test } from 'bun:test'
import { product, settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')

const { ProductCard } = await import('@/components/pos/product-card')
const { SessionProvider } = await import('@/components/session-provider')

const renderCard = (
    overrides: Parameters<typeof product>[0] = {},
    props: {
        pending?: boolean
        qty?: number
        maxQty?: number
        onSelect?: ReturnType<typeof mock>
        onChangeQty?: ReturnType<typeof mock>
        onConfirm?: ReturnType<typeof mock>
    } = {}
) => {
    const onSelect = props.onSelect ?? mock(() => {})
    const onChangeQty = props.onChangeQty ?? mock(() => {})
    const onConfirm = props.onConfirm ?? mock(() => {})
    const item = product(overrides)
    const maxQty = props.maxQty ?? (item.stock === null || item.stock <= 0 ? 0 : item.stock)
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <ProductCard
                    product={item}
                    pending={props.pending ?? false}
                    qty={props.qty ?? 1}
                    maxQty={maxQty}
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

describe('ProductCard', () => {
    test('shows the price and the stock badge on their own rows, and calls onSelect when clicked', () => {
        const { onSelect } = renderCard({ id: 'p-1', name: 'Wireless Mouse', selling_price: 29.99, stock: 3 })
        expect(screen.getByText('$29.99')).toBeTruthy()
        expect(screen.getByText('3 left')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Add Wireless Mouse to cart' }))
        expect(onSelect).toHaveBeenCalledTimes(1)
    })

    test('pending overlay: −/+ call onChangeQty and Confirm calls onConfirm', () => {
        const { onChangeQty, onConfirm } = renderCard(
            { id: 'p-1', name: 'Wireless Mouse', stock: 3 },
            { pending: true, qty: 2, maxQty: 3 }
        )
        expect(screen.getByText('2')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
        expect(onChangeQty).toHaveBeenCalledWith(3)
        fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
        expect(onChangeQty).toHaveBeenCalledWith(1)
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    test('pending overlay: + is disabled at maxQty', () => {
        renderCard({ id: 'p-1', name: 'Wireless Mouse', stock: 2 }, { pending: true, qty: 2, maxQty: 2 })
        expect((screen.getByRole('button', { name: 'Increase quantity' }) as HTMLButtonElement).disabled).toBe(true)
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
        const { onSelect } = renderCard({ name: 'Gone', stock: 0 })
        expect(screen.getByText('Out of stock')).toBeTruthy()
        const card = screen.getByRole('button', { name: 'Add Gone to cart' })
        expect(card.getAttribute('aria-disabled')).toBe('true')
        fireEvent.click(card)
        expect(onSelect).not.toHaveBeenCalled()
    })

    test('the image box keeps a fixed aspect ratio and lazy-loads with async decoding', () => {
        renderCard({ name: 'Framed', image_url: 'https://example.com/framed.jpg' })
        const img = screen.getByAltText('')
        expect(img.closest('div')?.className).toContain('aspect-[4/3]')
        expect(img.getAttribute('loading')).toBe('lazy')
        expect(img.getAttribute('decoding')).toBe('async')
    })

    test('falls back to the reserve icon, in the same fixed-ratio box, when the image fails to load', () => {
        renderCard({ name: 'Broken Image', image_url: 'https://example.com/broken.jpg' })
        const img = screen.getByAltText('')
        const box = img.closest('div')
        fireEvent.error(img)
        expect(screen.queryByAltText('')).toBeNull()
        expect(box?.className).toContain('aspect-[4/3]')
        expect(box?.querySelector('svg')).toBeTruthy()
    })

    test('a fresh URL after a failed (e.g. expired signed) one shows the image again on the same mounted card', () => {
        const view = (image_url: string) => (
            <IntlProvider>
                <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                    <ProductCard
                        product={product({ name: 'Refetched', image_url })}
                        pending={false}
                        qty={1}
                        maxQty={5}
                        onSelect={() => {}}
                        onChangeQty={() => {}}
                        onConfirm={() => {}}
                    />
                </SessionProvider>
            </IntlProvider>
        )
        const { rerender } = render(view('https://example.com/p.jpg?X-Amz-Signature=old'))
        fireEvent.error(screen.getByAltText(''))
        expect(screen.queryByAltText('')).toBeNull()

        // Same URL again (no refetch yet): still the fallback, no retry loop.
        rerender(view('https://example.com/p.jpg?X-Amz-Signature=old'))
        expect(screen.queryByAltText('')).toBeNull()

        rerender(view('https://example.com/p.jpg?X-Amz-Signature=new'))
        expect(screen.getByAltText('').getAttribute('src')).toBe('https://example.com/p.jpg?X-Amz-Signature=new')
    })

    test('without an image, the placeholder box has the same fixed aspect ratio as a filled one', () => {
        renderCard({ name: 'No Image', image_url: null })
        const card = screen.getByRole('button', { name: 'Add No Image to cart' })
        const box = card.firstElementChild
        expect(box?.className).toContain('aspect-[4/3]')
        expect(box?.querySelector('svg')).toBeTruthy()
    })
})
