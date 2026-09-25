import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import type { ReceivableRow } from '@/lib/api/receivables'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react')

const row: ReceivableRow = {
    customer_name: 'Jane Doe',
    debtor_name: null,
    customer_id: 'cust-1',
    order_id: 'order-1',
    order_number: 'ORD-260925-000001',
    total: 80,
    paid: 20,
    balance: 60,
    due_date: '2099-01-15',
    reminder_enabled: false,
    reminder_note: null,
    status: 'pending',
    days_overdue: 0
}

const list = mock(async () => [row])
const pay = mock(
    async (_id: string, _body: { payments: Array<{ method: string; amount: number }> }, _key?: string) => ({
        balance: 0,
        status: 'completed'
    })
)

void mock.module('@/lib/api/receivables', () => ({
    receivablesApi: { list, pay, update: async () => {}, writeOff: async () => {} }
}))

const { default: ReceivablesPage } = await import('@/app/(dashboard)/receivables/page')
const { SessionProvider } = await import('@/components/session-provider')

const renderPage = () =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <ReceivablesPage />
            </SessionProvider>
        </IntlProvider>
    )

const openPayDialog = async () => {
    renderPage()
    await screen.findAllByText('Jane Doe')
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Record payment' }))
    return screen.findByRole('dialog', { name: 'Record payment' })
}

beforeEach(() => {
    list.mockClear()
    pay.mockClear()
})
afterEach(cleanup)

describe('receivables PayDialog', () => {
    test('the amount is capped to the balance and cash short/change shows', async () => {
        const dialog = await openPayDialog()
        expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('60.00')

        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '90' } })
        expect(within(dialog).getByText('Invalid amount')).toBeTruthy()
        expect((within(dialog).getByRole('button', { name: 'Record payment' }) as HTMLButtonElement).disabled).toBe(
            true
        )

        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '60' } })
        fireEvent.change(within(dialog).getByLabelText('Cash received'), { target: { value: '10' } })
        expect(within(dialog).getByText(/Short \$50/)).toBeTruthy()

        fireEvent.change(within(dialog).getByLabelText('Cash received'), { target: { value: '70' } })
        expect(within(dialog).getByText(/Change: \$10/)).toBeTruthy()
    })

    test('submit sends the payments and the dialog idempotency key', async () => {
        const dialog = await openPayDialog()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }))

        await waitFor(() => expect(pay).toHaveBeenCalledTimes(1))
        expect(pay.mock.calls[0]?.[0]).toBe('order-1')
        expect(pay.mock.calls[0]?.[1]).toEqual({ payments: [{ method: 'cash', amount: 60 }] })
        expect(pay.mock.calls[0]?.[2]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })
})
