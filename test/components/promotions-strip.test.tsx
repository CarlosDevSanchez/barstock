import { afterEach, describe, expect, mock, test } from 'bun:test'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import type { PromotionListItem } from '@/lib/api/promotions'

setupDom()
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')

const { PromotionsStrip } = await import('@/components/pos/promotions-strip')
const { SessionProvider } = await import('@/components/session-provider')

function promo(id: string, name: string): PromotionListItem {
    return {
        id,
        name,
        package_price: 17,
        is_active: true,
        deleted_at: null,
        created_at: '',
        updated_at: '',
        available: 5,
        items: [
            {
                id: `${id}-i1`,
                product_id: 'p1',
                quantity: 4,
                product: {
                    id: 'p1',
                    name: 'Beer',
                    is_active: true,
                    deleted_at: null,
                    selling_price: 5,
                    tax_rate: 0,
                    stock: 20
                }
            }
        ]
    }
}

afterEach(() => {
    cleanup()
    mock.restore()
})

describe('PromotionsStrip', () => {
    test('horizontal expand opens the browse dialog', () => {
        render(
            <IntlProvider>
                <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                    <PromotionsStrip
                        promotions={[promo('pr1', 'Bucket'), promo('pr2', 'Combo')]}
                        loading={false}
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

        fireEvent.click(screen.getByRole('button', { name: /ver todas|view all/i }))
        expect(screen.getByRole('dialog')).toBeTruthy()
        expect(screen.getAllByText('Bucket').length).toBeGreaterThanOrEqual(2)
        expect(screen.getAllByText('Combo').length).toBeGreaterThanOrEqual(2)
    })
})
