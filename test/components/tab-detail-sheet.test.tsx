import { afterEach, describe, expect, mock, test } from 'bun:test'
import { useState } from 'react'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import type { TabDetail } from '@/lib/api/tabs'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react')

function tab(overrides: Partial<TabDetail> & Pick<TabDetail, 'id' | 'tab_number' | 'label'>): TabDetail {
    return {
        closed_at: null,
        closed_by: null,
        customer_id: null,
        discount: 0,
        opened_at: '2026-09-21T00:00:00Z',
        opened_by: null,
        order_id: null,
        status: 'open',
        updated_at: '2026-09-21T00:00:00Z',
        void_reason: null,
        voided_at: null,
        voided_by: null,
        customer: null,
        members: [],
        items: [],
        payments: [],
        totals: { subtotal: 0, tax: 0, discount: 0, total: 0, paid: 0, balance: 0 },
        ...overrides
    }
}

const tabA = tab({
    id: 'tab-a',
    tab_number: 'TAB-000001',
    label: 'Table A',
    totals: { subtotal: 100, tax: 0, discount: 0, total: 100, paid: 0, balance: 100 }
})
const tabB = tab({
    id: 'tab-b',
    tab_number: 'TAB-000002',
    label: 'Table B',
    totals: { subtotal: 50, tax: 0, discount: 0, total: 50, paid: 0, balance: 50 }
})
const tabsById: Record<string, TabDetail> = { 'tab-a': tabA, 'tab-b': tabB }

const pay = mock(async () => tabA)
const paySplit = mock(async () => tabA)

void mock.module('@/lib/api/tabs', () => ({
    tabsApi: {
        get: async (id: string) => tabsById[id],
        pay,
        paySplit,
        removeItem: async () => tabA,
        void: async () => tabA,
        defer: async () => ({ id: 'order-1' })
    }
}))
void mock.module('next/navigation', () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} })
}))

const { TabDetailSheet } = await import('@/components/pos/tab-detail-sheet')
const { SessionProvider } = await import('@/components/session-provider')

/** Mirrors how app/(dashboard)/pos/page.tsx renders TabDetailSheet: no `key` on it, `tabId` is just a prop that
 * changes — the same shape as the real bug (state owned by TabDetailSheet itself must reset via effect, not via
 * a child `key`, since the parent never remounts the whole sheet). */
function Harness() {
    const [tabId, setTabId] = useState<string | null>('tab-a')
    return (
        <>
            <button type="button" onClick={() => setTabId('tab-b')}>
                Switch to tab B
            </button>
            <TabDetailSheet tabId={tabId} onClose={() => setTabId(null)} onChanged={() => {}} />
        </>
    )
}

const renderHarness = () =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <Harness />
            </SessionProvider>
        </IntlProvider>
    )

afterEach(cleanup)

describe('TabDetailSheet — payment state resets when the parent swaps tabId', () => {
    test('an open payment dialog for tab A is closed (not silently pointed at tab B) once the tab switches', async () => {
        renderHarness()

        // Tab A loads; open the payment dialog for its full balance ($100).
        const payButton = await screen.findByRole('button', { name: /Pay full balance/ })
        fireEvent.click(payButton)
        const amountField = await screen.findByLabelText('Amount')
        expect((amountField as HTMLInputElement).value).toBe('100.00')

        // The parent swaps which tab is open — TabDetailSheet itself is never remounted (no `key` in the real
        // caller either), only `tabId` changes. Radix marks the rest of the document `aria-hidden` while the
        // sheet is open (correct a11y behavior), so this harness button needs `hidden: true` to be found —
        // that's a test-harness quirk, not something the real bug fix depends on.
        fireEvent.click(screen.getByRole('button', { name: 'Switch to tab B', hidden: true }))

        // Tab B's own content must load...
        await screen.findByText('TAB-000002')
        // ...and the payment dialog that was open for tab A's $100 balance must be gone, not still open and
        // submittable against tab B with the stale amount/member.
        await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull())
        expect(pay).not.toHaveBeenCalled()
    })

    test('re-opening "Pay full balance" after the switch uses tab B\'s own balance, not the stale one', async () => {
        renderHarness()
        fireEvent.click(await screen.findByRole('button', { name: /Pay full balance/ }))
        await screen.findByLabelText('Amount')

        fireEvent.click(screen.getByRole('button', { name: 'Switch to tab B', hidden: true }))
        await screen.findByText('TAB-000002')

        const payButtonB = await screen.findByRole('button', { name: /Pay full balance/ })
        expect(payButtonB.textContent).toContain('50')
        fireEvent.click(payButtonB)
        const amountField = await screen.findByLabelText('Amount')
        expect((amountField as HTMLInputElement).value).toBe('50.00')
    })
})
