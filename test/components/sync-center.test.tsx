import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { IntlProvider, settings, userWithRole } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react')

let entries: Array<{
    client_ref: string
    provisional_number: string
    state: string
    expected_total: number
    last_error?: string
}> = []

const listOutboxEntries = mock(async () => entries)
const retryOutboxEntry = mock(async (clientRef: string) => {
    entries = entries.map(entry => (entry.client_ref === clientRef ? { ...entry, state: 'pending' } : entry))
})
const discardOutboxEntry = mock(async (clientRef: string) => {
    entries = entries.filter(entry => entry.client_ref !== clientRef)
})

void mock.module('@/lib/offline/outbox', () => ({ listOutboxEntries, retryOutboxEntry, discardOutboxEntry }))

const { SyncCenter } = await import('@/components/offline/sync-center')
const { SessionProvider } = await import('@/components/session-provider')

const renderSyncCenter = (pendingCount = 0, onSyncNow = () => {}) =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <SyncCenter pendingCount={pendingCount} onSyncNow={onSyncNow} />
            </SessionProvider>
        </IntlProvider>
    )

beforeEach(() => {
    entries = []
    listOutboxEntries.mockClear()
    retryOutboxEntry.mockClear()
    discardOutboxEntry.mockClear()
})
afterEach(cleanup)

describe('SyncCenter', () => {
    test('renders nothing when the outbox has no entry needing attention', async () => {
        renderSyncCenter()
        await waitFor(() => expect(listOutboxEntries).toHaveBeenCalled())
        expect(screen.queryByRole('button', { name: /queued sale/ })).toBeNull()
    })

    test('a synced entry does not count: still hidden', async () => {
        entries = [{ client_ref: 'a', provisional_number: 'OFF-AAAAAAAA', state: 'synced', expected_total: 10 }]
        renderSyncCenter()
        await waitFor(() => expect(listOutboxEntries).toHaveBeenCalled())
        expect(screen.queryByRole('button', { name: /queued sale/ })).toBeNull()
    })

    test('shows the button with a count, and opens the sheet with the entry', async () => {
        entries = [{ client_ref: 'a', provisional_number: 'OFF-AAAAAAAA', state: 'pending', expected_total: 12.5 }]
        renderSyncCenter()
        const button = await screen.findByRole('button', { name: '1 queued sale' })
        fireEvent.click(button)
        expect(await screen.findByText('OFF-AAAAAAAA')).toBeTruthy()
        expect(screen.getByText('Waiting to sync')).toBeTruthy()
    })

    test('retry calls retryOutboxEntry and the sync trigger for a rejected entry', async () => {
        entries = [
            {
                client_ref: 'a',
                provisional_number: 'OFF-AAAAAAAA',
                state: 'rejected',
                expected_total: 10,
                last_error: 'Product not available'
            }
        ]
        const onSyncNow = mock(() => {})
        renderSyncCenter(0, onSyncNow)
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        expect(screen.getByText('Product not available')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        await waitFor(() => expect(retryOutboxEntry).toHaveBeenCalledWith('a'))
        expect(onSyncNow).toHaveBeenCalled()
    })

    test('a pending entry has no retry button (nothing to retry yet)', async () => {
        entries = [{ client_ref: 'a', provisional_number: 'OFF-AAAAAAAA', state: 'pending', expected_total: 10 }]
        renderSyncCenter()
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        await screen.findByText('OFF-AAAAAAAA')
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    })

    test('discard requires a reason, then removes the entry from the list', async () => {
        entries = [{ client_ref: 'a', provisional_number: 'OFF-AAAAAAAA', state: 'rejected', expected_total: 10 }]
        renderSyncCenter()
        fireEvent.click(await screen.findByRole('button', { name: /queued sale/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

        const dialog = await screen.findByRole('dialog', { name: /Discard OFF-AAAAAAAA/ })
        const confirmButton = () => screen.getByRole('button', { name: 'Discard' })
        expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)

        fireEvent.change(dialog.querySelector('#discard-reason')!, { target: { value: 'customer left' } })
        expect((confirmButton() as HTMLButtonElement).disabled).toBe(false)
        fireEvent.click(confirmButton())

        await waitFor(() => expect(discardOutboxEntry).toHaveBeenCalledWith('a'))
        await waitFor(() => expect(screen.queryByText('OFF-AAAAAAAA')).toBeNull())
    })
})
