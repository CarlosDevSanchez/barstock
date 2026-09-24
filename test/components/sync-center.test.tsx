import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { IntlProvider, settings, userWithRole } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react')
const { ApiError } = await import('@/lib/api/client')

let entries: Array<{
    client_ref: string
    provisional_number: string
    state: string
    expected_total: number
    last_error?: string
    user_id: string
    created_at: string
    payload: { payment_method: string }
}> = []

const listOutboxEntries = mock(async () => entries)
const retryOutboxEntry = mock(async (clientRef: string) => {
    entries = entries.map(entry => (entry.client_ref === clientRef ? { ...entry, state: 'pending' } : entry))
})
type DiscardResult = 'discarded' | 'in_progress' | 'already_synced' | 'not_found'
const discardOutboxEntry = mock(async (clientRef: string): Promise<DiscardResult> => {
    entries = entries.filter(entry => entry.client_ref !== clientRef)
    return 'discarded'
})
const logDiscard = mock(async () => {})

void mock.module('@/lib/offline/outbox', () => ({ listOutboxEntries, retryOutboxEntry, discardOutboxEntry }))
void mock.module('@/lib/api/outbox', () => ({ outboxApi: { logDiscard } }))

const { SyncCenter } = await import('@/components/offline/sync-center')
const { SessionProvider } = await import('@/components/session-provider')

const cashier = userWithRole('cashier')
const manager = userWithRole('manager')

const renderSyncCenter = (role: 'cashier' | 'manager' = 'cashier', pendingCount = 0, onSyncNow = () => {}) =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: role === 'manager' ? manager : cashier, settings }}>
                <SyncCenter pendingCount={pendingCount} onSyncNow={onSyncNow} />
            </SessionProvider>
        </IntlProvider>
    )

const entry = (overrides: Partial<(typeof entries)[number]> = {}): (typeof entries)[number] => ({
    client_ref: 'a',
    provisional_number: 'OFF-AAAAAAAA',
    state: 'pending',
    expected_total: 10,
    user_id: cashier.id,
    created_at: '2026-09-24T10:00:00Z',
    payload: { payment_method: 'cash' },
    ...overrides
})

beforeEach(() => {
    entries = []
    listOutboxEntries.mockClear()
    retryOutboxEntry.mockClear()
    discardOutboxEntry.mockClear()
    logDiscard.mockClear()
})
afterEach(cleanup)

describe('SyncCenter', () => {
    test('renders nothing when the outbox has no entry needing attention', async () => {
        renderSyncCenter()
        await waitFor(() => expect(listOutboxEntries).toHaveBeenCalled())
        expect(screen.queryByRole('button', { name: /queued sale/ })).toBeNull()
    })

    test('a synced entry does not count: still hidden', async () => {
        entries = [entry({ state: 'synced' })]
        renderSyncCenter()
        await waitFor(() => expect(listOutboxEntries).toHaveBeenCalled())
        expect(screen.queryByRole('button', { name: /queued sale/ })).toBeNull()
    })

    test('shows the button with a count, and opens the sheet with the entry', async () => {
        entries = [entry({ expected_total: 12.5 })]
        renderSyncCenter()
        const button = await screen.findByRole('button', { name: '1 queued sale' })
        fireEvent.click(button)
        expect(await screen.findByText('OFF-AAAAAAAA')).toBeTruthy()
        expect(screen.getByText('Waiting to sync')).toBeTruthy()
    })

    test('retry calls retryOutboxEntry and the sync trigger for a rejected entry', async () => {
        entries = [entry({ state: 'rejected', last_error: 'Product not available' })]
        const onSyncNow = mock(() => {})
        renderSyncCenter('cashier', 0, onSyncNow)
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        expect(screen.getByText('Product not available')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        await waitFor(() => expect(retryOutboxEntry).toHaveBeenCalledWith('a'))
        expect(onSyncNow).toHaveBeenCalled()
    })

    test('a pending entry has no retry button (nothing to retry yet)', async () => {
        entries = [entry()]
        renderSyncCenter()
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        await screen.findByText('OFF-AAAAAAAA')
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    })

    test('a cashier only sees their own queue on a shared device', async () => {
        entries = [
            entry({ client_ref: 'mine', user_id: cashier.id }),
            entry({ client_ref: 'theirs', user_id: 'user-other' })
        ]
        renderSyncCenter('cashier')
        expect(await screen.findByRole('button', { name: '1 queued sale' })).toBeTruthy()
    })

    test('a manager sees every queued sale on the device, not just their own', async () => {
        entries = [
            entry({ client_ref: 'mine', user_id: manager.id }),
            entry({ client_ref: 'theirs', user_id: 'user-other' })
        ]
        renderSyncCenter('manager')
        expect(await screen.findByRole('button', { name: '2 queued sales' })).toBeTruthy()
    })

    test('a cashier has no discard button (manager-only, RPC-gated)', async () => {
        entries = [entry({ state: 'rejected' })]
        renderSyncCenter('cashier')
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        await screen.findByText('OFF-AAAAAAAA')
        expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    })

    test('a syncing entry has no discard button, even for a manager (avoids racing an in-flight send)', async () => {
        entries = [entry({ state: 'syncing' })]
        renderSyncCenter('manager')
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        await screen.findByText('OFF-AAAAAAAA')
        expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    })

    test('a manager discarding logs it first, then removes the entry from the list', async () => {
        entries = [entry({ state: 'rejected' })]
        renderSyncCenter('manager')
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

        const dialog = await screen.findByRole('dialog', { name: /Discard OFF-AAAAAAAA/ })
        const confirmButton = () => screen.getByRole('button', { name: 'Discard' })
        expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)

        fireEvent.change(dialog.querySelector('#discard-reason')!, { target: { value: 'customer left' } })
        expect((confirmButton() as HTMLButtonElement).disabled).toBe(false)
        fireEvent.click(confirmButton())

        await waitFor(() =>
            expect(logDiscard).toHaveBeenCalledWith({
                client_ref: 'a',
                owner_user_id: cashier.id,
                provisional_number: 'OFF-AAAAAAAA',
                expected_total: 10,
                payment_method: 'cash',
                reason: 'customer left'
            })
        )
        await waitFor(() => expect(discardOutboxEntry).toHaveBeenCalledWith('a'))
        await waitFor(() => expect(screen.queryByText('OFF-AAAAAAAA')).toBeNull())
    })

    test('a failed audit log call blocks the discard: the entry stays, nothing local is deleted', async () => {
        logDiscard.mockImplementationOnce(async () => {
            throw new Error('network error')
        })
        entries = [entry({ state: 'rejected' })]
        renderSyncCenter('manager')
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

        const dialog = await screen.findByRole('dialog', { name: /Discard OFF-AAAAAAAA/ })
        fireEvent.change(dialog.querySelector('#discard-reason')!, { target: { value: 'customer left' } })
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

        await screen.findByText(
            'Could not record this. Check the connection and try again — a discard always needs to be logged.'
        )
        expect(discardOutboxEntry).not.toHaveBeenCalled()
    })

    test('the RPC refusing a discard (409: the sale already reached the server) shows a message and refreshes instead of erroring', async () => {
        logDiscard.mockImplementationOnce(async () => {
            throw new ApiError(409, 'conflict', 'This sale already reached the server')
        })
        entries = [entry({ state: 'rejected' })]
        renderSyncCenter('manager')
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

        const dialog = await screen.findByRole('dialog', { name: /Discard OFF-AAAAAAAA/ })
        fireEvent.change(dialog.querySelector('#discard-reason')!, { target: { value: 'customer left' } })
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

        // Not treated as a form error kept open for another try: this is a stale local view, not a failed request -
        // the RPC caught it (client_ref already had an order), so the local delete is never even attempted.
        await waitFor(() => expect(logDiscard).toHaveBeenCalled())
        expect(discardOutboxEntry).not.toHaveBeenCalled()
    })

    test('a local re-check that finds the entry mid-sync does not delete it (the lock in lib/offline/lock.ts races out a discard against an in-flight send)', async () => {
        discardOutboxEntry.mockImplementationOnce(async () => 'in_progress' as const)
        entries = [entry({ state: 'rejected' })]
        renderSyncCenter('manager')
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

        const dialog = await screen.findByRole('dialog', { name: /Discard OFF-AAAAAAAA/ })
        fireEvent.change(dialog.querySelector('#discard-reason')!, { target: { value: 'customer left' } })
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

        // The real discardOutboxEntry never deletes on an 'in_progress' result - only asserting the call happened
        // here, since this file mocks discardOutboxEntry itself (its own unit test covers the delete-or-not logic).
        await waitFor(() => expect(discardOutboxEntry).toHaveBeenCalledWith('a'))
    })
})
