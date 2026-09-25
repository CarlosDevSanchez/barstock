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
    onSubmit = () => {}
}: {
    amountDue?: number
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
