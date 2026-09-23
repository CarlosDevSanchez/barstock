import { expect, test } from '@playwright/test'
import { createProduct, uniq } from '../test/helpers/integration'
import { newSession } from './helpers'

// Needs the production build (webServer in playwright.config.ts): the service worker only registers in production
// (components/pwa/sw-register.tsx). A page is only "controlled" by the service worker from its SECOND load onward
// (the load that installs the worker is never itself intercepted), hence the extra reload before going offline.
test('cached views stay usable offline, with a visible badge and checkout disabled', async ({ browser }) => {
    const product = await createProduct({ name: uniq('E2E Offline Beer'), selling_price: 15, tax_rate: 0, stock: 10 })
    const page = await newSession(browser, 'cashier')

    await page.goto('/products')
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true))
    // The load above installed the service worker; reload so THIS load is controlled and gets cached.
    await page.reload()
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()

    // Visit and cache /pos too, with an item already in the cart.
    await page.goto('/pos')
    await page.getByPlaceholder('Search by name, SKU, or barcode...').fill(product.name)
    await page.getByRole('button', { name: `Add ${product.name} to cart` }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await page.reload()

    await page.context().setOffline(true)
    await page.reload()

    // The cached page still renders, the badge shows, and a persistent toast explains why.
    await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible()
    await expect(page.getByText('Offline', { exact: true })).toBeVisible()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'You are offline' })).toBeVisible()

    // Checkout (a write) is disabled while offline.
    await page.getByRole('button', { name: /^Cart:/ }).click()
    const cartSheet = page.getByRole('dialog', { name: /^Cart/ })
    await expect(cartSheet.getByRole('button', { name: 'Checkout' })).toBeDisabled()

    await page.context().setOffline(false)
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Back online' })).toBeVisible()
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0)
})
