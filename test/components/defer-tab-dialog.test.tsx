import { afterEach, describe, expect, mock, test } from 'bun:test'
import { settings, userWithRole, IntlProvider, page } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import type { TabDetail } from '@/lib/api/tabs'

setupDom()
const { cleanup, fireEvent, render, screen, within } = await import('@testing-library/react')

const defer = mock(async () => ({ id: 'order-1' }))
void mock.module('@/lib/api/tabs', () => ({
    tabsApi: { defer }
}))
void mock.module('@/lib/api/customers', () => ({
    customersApi: { list: async () => page([]) }
}))

const { DeferTabDialog } = await import('@/components/pos/defer-tab-dialog')
const { SessionProvider } = await import('@/components/session-provider')

function tab(overrides: Partial<Pick<TabDetail, 'id' | 'label' | 'customer' | 'totals'>> = {}) {
    return {
        id: 'tab-1',
        label: 'Mesa 4',
        customer: null,
        totals: { subtotal: 100, tax: 0, discount: 0, total: 100, paid: 20, balance: 80 },
        ...overrides
    }
}

const renderDialog = (overrides?: Parameters<typeof tab>[0]) =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <DeferTabDialog tab={tab(overrides)} onClose={() => {}} onDeferred={() => {}} />
            </SessionProvider>
        </IntlProvider>
    )

afterEach(() => {
    defer.mockClear()
    cleanup()
})

describe('DeferTabDialog', () => {
    test('submit stays disabled until there is a customer or a debtor name', async () => {
        renderDialog({ label: '' })
        const dialog = await screen.findByRole('dialog', { name: 'Close as receivable' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Name only' }))
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '' } })
        fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2099-01-15' } })

        expect(
            (within(dialog).getByRole('button', { name: 'Close as receivable' }) as HTMLButtonElement).disabled
        ).toBe(true)

        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Ana' } })
        expect(
            (within(dialog).getByRole('button', { name: 'Close as receivable' }) as HTMLButtonElement).disabled
        ).toBe(false)
    })

    test('the live summary subtracts the abono from the remaining balance', async () => {
        renderDialog()
        const dialog = await screen.findByRole('dialog', { name: 'Close as receivable' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Pay part now' }))
        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '30' } })

        expect(within(dialog).getByText('Total')).toBeTruthy()
        expect(within(dialog).getByText('$100.00')).toBeTruthy()
        expect(within(dialog).getByText('Paid')).toBeTruthy()
        expect(within(dialog).getByText('$20.00')).toBeTruthy()
        expect(within(dialog).getByText('Paying now')).toBeTruthy()
        expect(within(dialog).getByText('$30.00')).toBeTruthy()
        expect(within(dialog).getByText('Remaining')).toBeTruthy()
        expect(within(dialog).getByText('$50.00')).toBeTruthy()
    })

    test('an abono that covers the whole balance is rejected in the UI', async () => {
        renderDialog({ label: 'Mesa 4' })
        const dialog = await screen.findByRole('dialog', { name: 'Close as receivable' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Name only' }))
        fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2099-01-15' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Pay part now' }))
        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '80' } })

        expect(within(dialog).getByText('Invalid amount')).toBeTruthy()
        expect(
            (within(dialog).getByRole('button', { name: 'Close as receivable' }) as HTMLButtonElement).disabled
        ).toBe(true)
    })
})
