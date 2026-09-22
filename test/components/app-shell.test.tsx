import { afterEach, describe, expect, mock, test } from 'bun:test'
import { settings, userWithRole } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, render, screen } = await import('@testing-library/react')

void mock.module('next/navigation', () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    usePathname: () => '/dashboard'
}))

const { AppShell } = await import('@/components/app-shell')

afterEach(cleanup)

const linksFor = (role: 'cashier' | 'manager' | 'admin') => {
    render(
        <AppShell user={userWithRole(role)} settings={settings}>
            <p>page</p>
        </AppShell>
    )
    // Desktop sidebar (the mobile sheet renders its own copy only when opened).
    const nav = screen.getByRole('navigation')
    return Array.from(nav.querySelectorAll('a')).map(link => link.textContent)
}

describe('navigation follows the role', () => {
    const CASHIER = ['Dashboard', 'POS', 'Products', 'Categories', 'Inventory', 'Orders', 'Customers']

    test('a cashier sees the till and the catalog, but not suppliers, reports, settings or users', () => {
        expect(linksFor('cashier')).toEqual(CASHIER)
    })

    test('a manager also sees suppliers and reports', () => {
        expect(linksFor('manager')).toEqual([...CASHIER, 'Suppliers', 'Reports'])
    })

    test('an admin sees everything, including settings and users', () => {
        expect(linksFor('admin')).toEqual([...CASHIER, 'Suppliers', 'Reports', 'Settings', 'Users'])
    })
})

describe('the shell', () => {
    test('shows the store name from the settings and the signed-in user with their role', () => {
        render(
            <AppShell user={{ ...userWithRole('manager'), fullName: 'Maria Lopez' }} settings={settings}>
                <p>page content</p>
            </AppShell>
        )
        expect(screen.getAllByText('Test Store').length).toBeGreaterThan(0)
        expect(screen.getByText('Maria Lopez')).toBeTruthy()
        expect(screen.getByText('manager')).toBeTruthy()
        expect(screen.getByText('page content')).toBeTruthy()
    })

    test('falls back to the email when the user has no name', () => {
        render(
            <AppShell user={userWithRole('cashier')} settings={settings}>
                <p>x</p>
            </AppShell>
        )
        expect(screen.getByText('cashier@test.dev')).toBeTruthy()
    })
})
