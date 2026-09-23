import { expect, test } from '@playwright/test'
import { adminClient, ensureTestUsers, TEST_PASSWORD } from '../test/helpers/integration'
import { pinEnglish } from './helpers'

test.beforeAll(async () => {
    await ensureTestUsers()
})

test('login and dashboard default to Spanish without an EN cookie', async ({ page }) => {
    const users = await ensureTestUsers()
    await adminClient().from('profiles').update({ locale: 'es' }).eq('id', users.cashier.id)

    await page.goto('/login')
    // CardTitle is a div, not a heading role.
    await expect(page.getByText('Bienvenido de nuevo')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled()

    await page.getByLabel('Correo').fill('cashier@barstock.test')
    await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await page.waitForURL('**/dashboard')
    await expect(page.locator('[data-slot="sidebar"] nav a').first()).toHaveText('Panel')
})

test('switching language in the menu persists on the next login', async ({ page }) => {
    const users = await ensureTestUsers()
    await adminClient().from('profiles').update({ locale: 'es' }).eq('id', users.cashier.id)

    await page.goto('/login')
    await page.getByLabel('Correo').fill('cashier@barstock.test')
    await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await page.waitForURL('**/dashboard')

    await page.locator('[data-slot="sidebar"]').getByRole('button').last().click()
    await page.getByRole('menuitem', { name: 'English' }).click()
    await expect(page.locator('[data-slot="sidebar"] nav a').first()).toHaveText('Dashboard')

    await page.locator('[data-slot="sidebar"]').getByRole('button').last().click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.waitForURL('**/login')

    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByLabel('Correo').fill('cashier@barstock.test')
    await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
    // After clearing cookies the login form is Spanish again, but the profile is EN.
    await page.getByRole('button', { name: 'Iniciar sesión' }).click()
    await page.waitForURL('**/dashboard')
    await expect(page.locator('[data-slot="sidebar"] nav a').first()).toHaveText('Dashboard')
})

test('English cookie on the login page keeps e2e helpers on EN labels', async ({ page }) => {
    await pinEnglish(page)
    await page.goto('/login')
    await expect(page.getByText('Welcome Back')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
})
