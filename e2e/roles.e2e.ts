import { expect, test } from '@playwright/test'
import { ensureTestUsers } from '../test/helpers/integration'
import { navLinks, newSession, signInWith } from './helpers'
import { TEST_PASSWORD } from '../test/helpers/integration'

const CASHIER_NAV = ['Dashboard', 'POS', 'Products', 'Categories', 'Inventory', 'Orders', 'Customers']

test('a cashier only sees the till and the catalog and is bounced from restricted pages', async ({ browser }) => {
    const page = await newSession(browser, 'cashier')
    expect(await navLinks(page)).toEqual(CASHIER_NAV)

    for (const path of ['/settings', '/users', '/reports', '/suppliers']) {
        await page.goto(path)
        await page.waitForURL('**/dashboard')
    }
    // No management controls on the catalog either.
    await page.goto('/products')
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Add Product/ })).toHaveCount(0)
})

test('the session is invisible to page scripts (an XSS could not steal it)', async ({ browser }) => {
    const page = await newSession(browser, 'cashier')
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/sb-|auth-token/)
    const cookies = await page.context().cookies()
    const session = cookies.filter(cookie => cookie.name.startsWith('sb-'))
    expect(session.length).toBeGreaterThan(0)
    expect(session.every(cookie => cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true)
    expect(
        await page.evaluate(() => (typeof localStorage === 'undefined' ? '' : JSON.stringify(localStorage)))
    ).not.toMatch(/access_token|refresh_token/)
})

test('from the browser console a cashier cannot escalate: the API answers 403', async ({ browser }) => {
    const users = await ensureTestUsers()
    const page = await newSession(browser, 'cashier')
    const call = (path: string, method: string, body?: unknown) =>
        page.evaluate(
            async ({ path, method, body }) => {
                const response = await fetch(`/api/v1/${path}`, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: body === undefined ? undefined : JSON.stringify(body)
                })
                return response.status
            },
            { path, method, body }
        )

    expect(await call(`users/${users.cashier.id}`, 'PATCH', { role: 'admin' })).toBe(403)
    expect(await call('users', 'GET')).toBe(403)
    expect(await call('users/invite', 'POST', { email: 'x@barstock.test', role: 'admin' })).toBe(403)
    expect(await call('settings', 'PATCH', { store_name: 'Hacked' })).toBe(403)
    expect(await call('products', 'POST', { name: 'x', sku: 'x', selling_price: 1 })).toBe(403)
    expect(await call('reports?from=2026-01-01&to=2026-01-02', 'GET')).toBe(403)
})

test('visiting a page while signed out goes to login and comes back after signing in', async ({ page }) => {
    await page.goto('/pos')
    await page.waitForURL('**/login?next=%2Fpos')
    await signInWith(page, 'cashier@barstock.test', TEST_PASSWORD, { stayOnPage: true })
    await page.waitForURL('**/pos')
    await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible()
})

test('the login redirect only follows same-site paths', async ({ page }) => {
    await page.goto('/login?next=https%3A%2F%2Fevil.example%2F')
    await signInWith(page, 'cashier@barstock.test', TEST_PASSWORD, { stayOnPage: true })
    await page.waitForURL('**/dashboard')
    expect(new URL(page.url()).origin).toBe('http://localhost:3000')
})

test('a wrong password and a disabled account show clear errors, and never put the password in the URL', async ({
    page
}) => {
    await signInWith(page, 'cashier@barstock.test', 'wrong-password-123')
    await expect(page.getByText('Invalid email or password')).toBeVisible()
    await signInWith(page, 'inactive@barstock.test', TEST_PASSWORD)
    await expect(page.getByText('This account is disabled')).toBeVisible()
    expect(page.url()).not.toMatch(/password|email=/)
})

test('signing out ends the session', async ({ browser }) => {
    const page = await newSession(browser, 'cashier')
    await page.locator('aside button', { hasText: 'cashier@barstock.test' }).click()
    await page.getByRole('menuitem', { name: 'Logout' }).click()
    await page.waitForURL('**/login')
    await page.goto('/dashboard')
    await page.waitForURL('**/login**')
    const status = await page.evaluate(async () => (await fetch('/api/v1/me')).status)
    expect(status).toBe(401)
})

test('an admin sees every section and settings persist across a reload', async ({ browser }) => {
    const page = await newSession(browser, 'admin')
    expect(await navLinks(page)).toEqual([...CASHIER_NAV, 'Suppliers', 'Reports', 'Settings', 'Users'])

    await page.goto('/settings')
    const name = page.getByLabel('Store Name')
    const original = await name.inputValue()
    await name.fill('Barstock E2E Shop')
    await page.getByRole('button', { name: 'Save Settings' }).click()
    await expect(page.getByText('Settings saved')).toBeVisible()
    await expect(page.locator('aside h1')).toHaveText('Barstock E2E Shop')
    await page.reload()
    await expect(page.locator('aside h1')).toHaveText('Barstock E2E Shop')

    await name.fill(original)
    await page.getByRole('button', { name: 'Save Settings' }).click()
    await expect(page.locator('aside h1')).toHaveText(original)
})
