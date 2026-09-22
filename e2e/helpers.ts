import { expect, type Browser, type Page } from '@playwright/test'
import { TEST_PASSWORD, type TestRole } from '../test/helpers/integration'

const EMAIL: Record<TestRole | 'inactive', string> = {
    admin: 'admin@barstock.test',
    manager: 'manager@barstock.test',
    cashier: 'cashier@barstock.test',
    inactive: 'inactive@barstock.test'
}

/** Existing e2e suites assert English UI; pin the preference cookie before the first paint. */
export async function pinEnglish(page: Page) {
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3000' }])
}

/** Signs in through the real form. The button is disabled until React hydrates, so waiting for it is the readiness check. */
export async function signInWith(page: Page, email: string, password: string, options: { stayOnPage?: boolean } = {}) {
    await pinEnglish(page)
    // `stayOnPage` keeps the current URL (e.g. /login?next=/pos) instead of opening a clean /login.
    if (!options.stayOnPage) await page.goto('/login')
    else await page.reload() // apply NEXT_LOCALE cookie on the already-open login page
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign In' }).click()
}

export async function signInAs(page: Page, role: TestRole) {
    await signInWith(page, EMAIL[role], TEST_PASSWORD)
    await page.waitForURL('**/dashboard')
}

/** A fresh browser context (own cookies): one per person at the shop. */
export async function newSession(browser: Browser, role: TestRole): Promise<Page> {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signInAs(page, role)
    return page
}

export const navLinks = async (page: Page) => page.locator('aside nav a').allTextContents()
