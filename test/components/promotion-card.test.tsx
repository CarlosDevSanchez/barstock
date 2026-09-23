import { afterEach, describe, expect, mock, test } from 'bun:test'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import type { PromotionListItem } from '@/lib/api/promotions'

setupDom()
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')

const { PromotionCard, formatPromoRecipe } = await import('@/components/pos/promotion-card')
const { SessionProvider } = await import('@/components/session-provider')

function promo(overrides: Partial<PromotionListItem> = {}): PromotionListItem {
    const beer = {
        id: 'pi-1',
        product_id: 'p-beer',
        quantity: 1,
        product: {
            id: 'p-beer',
            name: 'Beer',
            is_active: true,
            deleted_at: null,
            selling_price: 3,
            tax_rate: 0,
            stock: 10
        }
    }
    const snack = {
        id: 'pi-2',
        product_id: 'p-snack',
        quantity: 1,
        product: {
            id: 'p-snack',
            name: 'Snack',
            is_active: true,
            deleted_at: null,
            selling_price: 5,
            tax_rate: 0,
            stock: 10
        }
    }
    return {
        id: 'promo-1',
        name: 'Combo',
        package_price: 7,
        is_active: true,
        deleted_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        items: [beer, snack],
        // Two packages sellable — must NOT become the default sell qty (that stays 1).
        available: 2,
        ...overrides
    }
}

const renderPromo = (
    promotion: PromotionListItem,
    props: {
        pending?: boolean
        qty?: number
        qtyInCart?: number
        onSelect?: ReturnType<typeof mock>
        onChangeQty?: ReturnType<typeof mock>
        onConfirm?: ReturnType<typeof mock>
    } = {}
) => {
    const onSelect = props.onSelect ?? mock(() => {})
    const onChangeQty = props.onChangeQty ?? mock(() => {})
    const onConfirm = props.onConfirm ?? mock(() => {})
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <PromotionCard
                    promotion={promotion}
                    pending={props.pending ?? false}
                    qty={props.qty ?? 1}
                    qtyInCart={props.qtyInCart ?? 0}
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

describe('PromotionCard', () => {
    test('shows package stock (not product units) and the recipe of distinct products', () => {
        renderPromo(promo())
        expect(screen.getByText('2 packages')).toBeTruthy()
        expect(screen.getByText('1× Beer · 1× Snack')).toBeTruthy()
        expect(screen.queryByText('2 left')).toBeNull()
        expect(screen.getByRole('button', { name: 'Add Combo to cart' }).getAttribute('title')).toContain('stock 10')
    })

    test('pending overlay starts at 1 package even when the recipe has 2 products and 2 packages are available', () => {
        const item = promo({ available: 2, items: promo().items })
        expect(item.items).toHaveLength(2)
        renderPromo(item, { pending: true, qty: 1 })
        expect(screen.getByText('1')).toBeTruthy()
        expect(screen.getByText('packages')).toBeTruthy()
        // The sell stepper must not show the recipe size (2) or available packages (2) as the draft qty.
        expect(screen.queryByText('2')).toBeNull()
    })

    test('click calls onSelect (parent sets pendingQty to 1 — never items.length)', () => {
        const { onSelect } = renderPromo(promo())
        fireEvent.click(screen.getByRole('button', { name: 'Add Combo to cart' }))
        expect(onSelect).toHaveBeenCalledTimes(1)
    })

    test('package stepper aria-labels and + respect max packages', () => {
        const { onChangeQty, onConfirm } = renderPromo(promo({ available: 2 }), {
            pending: true,
            qty: 1,
            qtyInCart: 0
        })
        fireEvent.click(screen.getByRole('button', { name: 'Increase packages' }))
        expect(onChangeQty).toHaveBeenCalledWith(2)
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    test('formatPromoRecipe joins component quantities, not sell packages', () => {
        expect(formatPromoRecipe(promo())).toBe('1× Beer · 1× Snack')
        const sixPack = promo({
            items: [
                {
                    id: 'pi-1',
                    product_id: 'p-beer',
                    quantity: 6,
                    product: {
                        id: 'p-beer',
                        name: 'Beer',
                        is_active: true,
                        deleted_at: null,
                        selling_price: 3,
                        tax_rate: 0,
                        stock: 20
                    }
                }
            ]
        })
        expect(formatPromoRecipe(sixPack)).toBe('6× Beer')
    })
})
