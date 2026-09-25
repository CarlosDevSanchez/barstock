import { afterEach, describe, expect, test } from 'bun:test'
import { useState } from 'react'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import type { PaymentMethod } from '@/types'

setupDom()
const { cleanup, fireEvent, render, screen, within } = await import('@testing-library/react')
const { PaymentDialog } = await import('@/components/pos/payment-dialog')
const { SessionProvider } = await import('@/components/session-provider')

/** Wraps `PaymentDialog` with its own `open` state so a test can close and reopen it (a "Reopen" button drives
 * that, since the dialog itself doesn't expose a trigger). */
function Harness({
    amountDue = 32.99,
    amountEditable = false,
    onSubmit = () => {}
}: {
    amountDue?: number
    amountEditable?: boolean
    onSubmit?: (payments: Array<{ method: PaymentMethod; amount: number }>) => void
}) {
    const [open, setOpen] = useState(true)
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Reopen
            </button>
            <PaymentDialog
                open={open}
                onOpenChange={setOpen}
                title="Complete Payment"
                amountDue={amountDue}
                amountEditable={amountEditable}
                submitLabel="Complete Order"
                processing={false}
                onSubmit={onSubmit}
            />
        </>
    )
}

const renderDialog = (props: Partial<Parameters<typeof Harness>[0]> = {}) =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <Harness {...props} />
            </SessionProvider>
        </IntlProvider>
    )

afterEach(cleanup)

describe('PaymentDialog — cash change/short', () => {
    test('shows "Falta" as soon as received is below the amount due', async () => {
        renderDialog({ amountDue: 9 })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        // Cash is the default method, so the cash-received field is visible without any extra clicks.
        fireEvent.change(within(dialog).getByLabelText('Cash received'), { target: { value: '1' } })
        expect(within(dialog).getByText(/Short \$8/)).toBeTruthy()
    })

    test('change appears the instant received crosses the amount due, not only when far over', async () => {
        renderDialog({ amountDue: 9 })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        const cashInput = within(dialog).getByLabelText('Cash received')

        // Still short by 8: no "Change" line yet.
        fireEvent.change(cashInput, { target: { value: '1' } })
        expect(within(dialog).queryByText(/Change:/)).toBeNull()

        // One more digit crosses the due amount by exactly $1 — change must show right away.
        fireEvent.change(cashInput, { target: { value: '10' } })
        expect(within(dialog).getByText(/Change: \$1/)).toBeTruthy()
    })

    test('shows "Sin cambio" wording ("No change") when received matches the amount due exactly', async () => {
        renderDialog({ amountDue: 9 })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.change(within(dialog).getByLabelText('Cash received'), { target: { value: '9' } })
        expect(within(dialog).getByText('No change')).toBeTruthy()
    })
})

describe('PaymentDialog — split payment', () => {
    test("the second method's options exclude whichever method the first row has selected", async () => {
        renderDialog()
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Split payment' }))

        // First payment defaults to cash; the second method must not offer cash again.
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Second payment' }))
        let listbox = await screen.findByRole('listbox')
        expect(within(listbox).queryByText('Cash')).toBeNull()
        expect(within(listbox).getByText('Card')).toBeTruthy()
        expect(within(listbox).getByText('E-Wallet')).toBeTruthy()
        fireEvent.click(within(listbox).getByText('Card'))

        // Switch the first method to card: the second (still card) collides, so it must move off card.
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'First payment' }))
        listbox = await screen.findByRole('listbox')
        fireEvent.click(within(listbox).getByText('Card'))

        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Second payment' }))
        listbox = await screen.findByRole('listbox')
        expect(within(listbox).queryByText('Card')).toBeNull()
    })

    test('changing the second method also clears received and the split amounts, like changing the first', async () => {
        renderDialog({ amountDue: 32.99 })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Split payment' }))

        const firstAmount = within(dialog).getByRole('textbox', { name: 'First payment Amount' })
        fireEvent.change(firstAmount, { target: { value: '10' } })
        fireEvent.change(within(dialog).getByLabelText('Cash received'), { target: { value: '50' } })
        expect(within(dialog).getByText(/Change:/)).toBeTruthy()
        expect((firstAmount as HTMLInputElement).value).not.toBe('')

        // Second payment defaults to card; switch it to e-wallet without touching the first method.
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Second payment' }))
        const listbox = await screen.findByRole('listbox')
        fireEvent.click(within(listbox).getByText('E-Wallet'))

        expect((firstAmount as HTMLInputElement).value).toBe('')
        expect(within(dialog).queryByLabelText('Cash received')).toBeNull() // cash is no longer involved
    })
})

describe('PaymentDialog — editable amount (partial payment)', () => {
    test('defaults to the full amount due, pre-filled and submittable as-is', async () => {
        const submitted: Array<Array<{ method: PaymentMethod; amount: number }>> = []
        renderDialog({ amountDue: 60, amountEditable: true, onSubmit: payments => submitted.push(payments) })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('60.00')

        fireEvent.click(within(dialog).getByRole('button', { name: 'Complete Order' }))
        expect(submitted).toEqual([[{ method: 'cash', amount: 60 }]])
    })

    test('typing a smaller amount pays only that much (an abono), not the full balance', async () => {
        const submitted: Array<Array<{ method: PaymentMethod; amount: number }>> = []
        renderDialog({ amountDue: 60, amountEditable: true, onSubmit: payments => submitted.push(payments) })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })

        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '20' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Complete Order' }))
        expect(submitted).toEqual([[{ method: 'cash', amount: 20 }]])
    })

    test('an amount above the balance shows "Invalid amount" and blocks submit', async () => {
        renderDialog({ amountDue: 60, amountEditable: true })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })

        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '90' } })
        expect(within(dialog).getByText('Invalid amount')).toBeTruthy()
        expect((within(dialog).getByRole('button', { name: 'Complete Order' }) as HTMLButtonElement).disabled).toBe(
            true
        )
    })

    test('a zero or empty amount also blocks submit', async () => {
        renderDialog({ amountDue: 60, amountEditable: true })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })

        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '' } })
        expect((within(dialog).getByRole('button', { name: 'Complete Order' }) as HTMLButtonElement).disabled).toBe(
            true
        )
    })

    test('"Full balance" resets a narrowed amount back to the full amount due', async () => {
        renderDialog({ amountDue: 60, amountEditable: true })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })

        const amountField = within(dialog).getByLabelText('Amount')
        fireEvent.change(amountField, { target: { value: '20' } })
        // A real click on another button blurs the field first (moving focus); fireEvent.click alone doesn't
        // simulate that focus shift, so it's done explicitly here — same reasoning as the blur in MoneyInput's
        // own "reformats on blur" behavior.
        fireEvent.blur(amountField)
        fireEvent.click(within(dialog).getByRole('button', { name: 'Full balance' }))
        expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('60.00')
    })

    test('with amountEditable off, no amount input is shown at all (the old, non-partial callers)', async () => {
        renderDialog({ amountDue: 60, amountEditable: false })
        const dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        expect(within(dialog).queryByLabelText('Amount')).toBeNull()
    })
})

describe('PaymentDialog — reset on open', () => {
    test('cash received and split amounts clear when the dialog is closed and reopened', async () => {
        renderDialog({ amountDue: 32.99 })
        let dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Split payment' }))
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'First payment Amount' }), {
            target: { value: '10' }
        })
        fireEvent.change(within(dialog).getByLabelText('Cash received'), { target: { value: '50' } })
        expect(within(dialog).getByText(/Change:/)).toBeTruthy()

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('dialog', { name: 'Complete Payment' })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
        dialog = await screen.findByRole('dialog', { name: 'Complete Payment' })

        // Split is off again, no cash-received field pre-filled: the whole-amount payment-method tiles are back.
        expect(within(dialog).getByRole('button', { name: 'Cash' })).toBeTruthy()
        expect(within(dialog).getByRole('button', { name: 'Split payment' }).getAttribute('aria-pressed')).toBe('false')
        fireEvent.change(within(dialog).getByLabelText('Cash received'), { target: { value: '0' } })
        expect(within(dialog).queryByText(/Change:/)).toBeNull()
    })
})
