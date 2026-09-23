import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { customer, page, settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react')

const existing = customer({ id: 'c-1', name: 'Jane Doe', email: 'jane@example.com', phone: '555-0100' })
const create = mock(async (body: unknown) => ({ id: 'new', ...(body as object) }))
const update = mock(async (_id: string, body: unknown) => ({ id: 'c-1', ...(body as object) }))
const remove = mock(async () => {})

void mock.module('@/lib/api/customers', () => ({
    customersApi: { list: async () => page([existing]), create, update, remove }
}))
void mock.module('next/navigation', () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    usePathname: () => '/customers'
}))

const { default: CustomersPage } = await import('@/app/(dashboard)/customers/page')
const { SessionProvider } = await import('@/components/session-provider')

const renderPage = (role: 'cashier' | 'manager' | 'admin') =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole(role), settings }}>
                <CustomersPage />
            </SessionProvider>
        </IntlProvider>
    )

beforeEach(() => {
    create.mockClear()
    update.mockClear()
    remove.mockClear()
})
afterEach(cleanup)

describe('who can edit and delete customers', () => {
    test('a cashier can edit but not delete', async () => {
        renderPage('cashier')
        await screen.findAllByText('Jane Doe')
        const table = within(screen.getByRole('table'))
        expect(table.getByRole('button', { name: 'Edit Jane Doe' })).toBeTruthy()
        expect(table.queryByRole('button', { name: /^Delete / })).toBeNull()
    })

    test('an admin can edit and delete', async () => {
        renderPage('admin')
        await screen.findAllByText('Jane Doe')
        const table = within(screen.getByRole('table'))
        expect(table.getByRole('button', { name: 'Edit Jane Doe' })).toBeTruthy()
        expect(table.getByRole('button', { name: 'Delete Jane Doe' })).toBeTruthy()
    })
})

describe('editing', () => {
    test('starts from the stored values and PATCHes', async () => {
        renderPage('cashier')
        await screen.findAllByText('Jane Doe')
        fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Edit Jane Doe' }))
        const dialog = await screen.findByRole('dialog')

        expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Jane Doe')
        fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane Renamed' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Update Customer' }))

        await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
        expect(update.mock.calls[0]?.[0]).toBe('c-1')
        expect(update.mock.calls[0]?.[1]).toMatchObject({ name: 'Jane Renamed' })
    })
})

describe('deleting', () => {
    test('asks for confirmation first and only then deletes; the click never navigates', async () => {
        renderPage('admin')
        await screen.findAllByText('Jane Doe')
        const table = within(screen.getByRole('table'))
        fireEvent.click(table.getByRole('button', { name: 'Delete Jane Doe' }))

        const dialog = await screen.findByRole('alertdialog')
        expect(within(dialog).getByText('Delete customer?')).toBeTruthy()
        expect(remove).not.toHaveBeenCalled()

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(remove).not.toHaveBeenCalled()

        fireEvent.click(table.getByRole('button', { name: 'Delete Jane Doe' }))
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
        await waitFor(() => expect(remove).toHaveBeenCalledWith('c-1'))
    })
})
