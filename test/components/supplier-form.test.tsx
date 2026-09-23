import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { page, settings, supplier, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react')

const existing = supplier({ id: 's-1', name: 'Acme Supply Co', contact_person: 'John Smith' })
const create = mock(async (body: unknown) => ({ id: 'new', ...(body as object) }))
const update = mock(async (_id: string, body: unknown) => ({ id: 's-1', ...(body as object) }))
const remove = mock(async () => {})

void mock.module('@/lib/api/suppliers', () => ({
    suppliersApi: { list: async () => page([existing]), create, update, remove }
}))
void mock.module('next/navigation', () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    usePathname: () => '/suppliers'
}))

const { default: SuppliersPage } = await import('@/app/(dashboard)/suppliers/page')
const { SessionProvider } = await import('@/components/session-provider')

// Only manager+ ever reaches this page (proxy.ts guards /suppliers), so "who can edit" is not tested here.
const renderPage = (role: 'manager' | 'admin') =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole(role), settings }}>
                <SuppliersPage />
            </SessionProvider>
        </IntlProvider>
    )

beforeEach(() => {
    create.mockClear()
    update.mockClear()
    remove.mockClear()
})
afterEach(cleanup)

describe('who can delete suppliers', () => {
    test('a manager can edit but not delete', async () => {
        renderPage('manager')
        await screen.findAllByText('Acme Supply Co')
        const table = within(screen.getByRole('table'))
        expect(table.getByRole('button', { name: 'Edit Acme Supply Co' })).toBeTruthy()
        expect(table.queryByRole('button', { name: /^Delete / })).toBeNull()
    })

    test('an admin can edit and delete', async () => {
        renderPage('admin')
        await screen.findAllByText('Acme Supply Co')
        const table = within(screen.getByRole('table'))
        expect(table.getByRole('button', { name: 'Edit Acme Supply Co' })).toBeTruthy()
        expect(table.getByRole('button', { name: 'Delete Acme Supply Co' })).toBeTruthy()
    })
})

describe('editing', () => {
    test('starts from the stored values and PATCHes', async () => {
        renderPage('manager')
        await screen.findAllByText('Acme Supply Co')
        fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Edit Acme Supply Co' }))
        const dialog = await screen.findByRole('dialog')

        expect((screen.getByLabelText('Contact Person') as HTMLInputElement).value).toBe('John Smith')
        fireEvent.change(screen.getByLabelText('Contact Person'), { target: { value: 'Ann Renamed' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Update Supplier' }))

        await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
        expect(update.mock.calls[0]?.[0]).toBe('s-1')
        expect(update.mock.calls[0]?.[1]).toMatchObject({ contact_person: 'Ann Renamed' })
    })
})

describe('deleting', () => {
    test('asks for confirmation first and only then deletes', async () => {
        renderPage('admin')
        await screen.findAllByText('Acme Supply Co')
        const table = within(screen.getByRole('table'))
        fireEvent.click(table.getByRole('button', { name: 'Delete Acme Supply Co' }))

        const dialog = await screen.findByRole('alertdialog')
        expect(within(dialog).getByText('Delete supplier?')).toBeTruthy()
        expect(remove).not.toHaveBeenCalled()

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(remove).not.toHaveBeenCalled()

        fireEvent.click(table.getByRole('button', { name: 'Delete Acme Supply Co' }))
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
        await waitFor(() => expect(remove).toHaveBeenCalledWith('s-1'))
    })
})
