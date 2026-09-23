import { afterEach, describe, expect, mock, test } from 'bun:test'
import { IntlProvider, settings, userWithRole } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, render, screen } = await import('@testing-library/react')

void mock.module('next/navigation', () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    usePathname: () => '/dashboard'
}))
void mock.module('@/lib/api/client', () => ({
    apiPost: async () => undefined,
    apiPatch: async () => undefined,
    errorMessage: (error: unknown, fallback = 'Something went wrong') =>
        error instanceof Error ? error.message : fallback
}))

const { AppShell } = await import('@/components/app-shell')

afterEach(cleanup)

const linksFor = (role: 'cashier' | 'manager' | 'admin') => {
    render(
        <IntlProvider>
            <AppShell user={userWithRole(role)} settings={settings}>
                <p>page</p>
            </AppShell>
        </IntlProvider>
    )
    // Desktop sidebar (the mobile sheet renders its own copy only when opened).
    const nav = screen.getByRole('navigation')
    return Array.from(nav.querySelectorAll('a')).map(link => link.textContent)
}

describe('navigation follows the role', () => {
    const CASHIER = ['Dashboard', 'POS', 'Products', 'Categories', 'Inventory', 'Orders', 'Customers']
    const MANAGER = [
        'Dashboard',
        'POS',
        'Products',
        'Categories',
        'Promotions',
        'Inventory',
        'Orders',
        'Customers',
        'Suppliers',
        'Reports'
    ]

    test('a cashier sees the till and the catalog, but not suppliers, reports, settings or users', () => {
        expect(linksFor('cashier')).toEqual(CASHIER)
    })

    test('a manager also sees suppliers and reports', () => {
        expect(linksFor('manager')).toEqual(MANAGER)
    })

    test('an admin sees everything, including settings and users', () => {
        expect(linksFor('admin')).toEqual([...MANAGER, 'Settings', 'Users'])
    })
})

describe('the shell', () => {
    test('shows the store name from the settings and the signed-in user with their role', () => {
        render(
            <IntlProvider>
                <AppShell user={{ ...userWithRole('manager'), fullName: 'Maria Lopez' }} settings={settings}>
                    <p>page content</p>
                </AppShell>
            </IntlProvider>
        )
        expect(screen.getAllByText('Test Store').length).toBeGreaterThan(0)
        expect(screen.getByText('Maria Lopez')).toBeTruthy()
        expect(screen.getByText('Manager')).toBeTruthy()
        expect(screen.getByText('page content')).toBeTruthy()
    })

    test('falls back to the email when the user has no name', () => {
        render(
            <IntlProvider>
                <AppShell user={userWithRole('cashier')} settings={settings}>
                    <p>x</p>
                </AppShell>
            </IntlProvider>
        )
        expect(screen.getByText('cashier@test.dev')).toBeTruthy()
    })
})
