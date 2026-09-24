import { expect, test } from '@playwright/test'
import { createProduct, stockOf, uniq } from '../test/helpers/integration'
import { newSession } from './helpers'

// Needs the production build (webServer in playwright.config.ts): the service worker only registers in production
// (components/pwa/sw-register.tsx). A page is only "controlled" by the service worker from its SECOND load onward
// (the load that installs the worker is never itself intercepted), hence the extra reload before going offline.
test('cached views stay usable offline, with a visible badge', async ({ browser }) => {
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

    await page.context().setOffline(false)
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Back online' })).toBeVisible()
    await expect(page.getByText('Offline', { exact: true })).toHaveCount(0)
})

// F3: checkout itself works offline now (it used to be disabled) — it queues the sale in IndexedDB and the sync
// engine (hooks/use-outbox-sync.ts, mounted in AppShell) sends it once the browser is back online.
test('checkout offline queues the sale, then syncs it automatically once back online', async ({ browser }) => {
    const product = await createProduct({ name: uniq('E2E Offline Rum'), selling_price: 15, tax_rate: 0, stock: 10 })
    const page = await newSession(browser, 'cashier')

    // Install the service worker and warm the POS catalog snapshot (F1) that backs an offline sale, same two-load
    // dance as the test above.
    await page.goto('/pos')
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.getByPlaceholder('Search by name, SKU, or barcode...').fill(product.name)
    await expect(page.getByRole('button', { name: `Add ${product.name} to cart` })).toBeVisible()

    await page.context().setOffline(true)
    await page.reload()
    await expect(page.getByText('Offline', { exact: true })).toBeVisible()

    await page.getByPlaceholder('Search by name, SKU, or barcode...').fill(product.name)
    await page.getByRole('button', { name: `Add ${product.name} to cart` }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await page.getByRole('button', { name: /^Cart:/ }).click()
    const cartSheet = page.getByRole('dialog', { name: /^Cart/ })
    const checkoutButton = cartSheet.getByRole('button', { name: 'Checkout' })
    await expect(checkoutButton).toBeEnabled() // no longer disabled offline (F3)
    await checkoutButton.click()
    await page.getByRole('button', { name: 'Cash' }).click()
    await page.getByRole('button', { name: 'Complete Order' }).click()

    const queuedToast = page.locator('[data-sonner-toast]').filter({ hasText: /^Sale OFF-/ })
    await expect(queuedToast).toBeVisible()
    await expect(page.getByRole('button', { name: /^Cart: 0 items/ })).toBeVisible()
    // Still offline: create_sale has not run yet, so stock has not moved.
    expect(await stockOf(product.id)).toBe(10)

    // Sync center (F4): shows up with the queued sale while there is nothing synced yet.
    await expect(page.getByRole('button', { name: '1 queued sale' })).toBeVisible()

    // The printed ticket says PROVISIONAL until this syncs (F4).
    await queuedToast.getByRole('button', { name: 'Print ticket' }).click()
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('receipt-provisional-stamp')).toHaveText('PROVISIONAL — pending sync')
    await page.emulateMedia({ media: 'screen' })

    await page.context().setOffline(false)
    await expect.poll(() => stockOf(product.id), { timeout: 15_000 }).toBe(9)
    // Synced: nothing left needing attention, so the sync center button goes away.
    await expect(page.getByRole('button', { name: /queued sale/ })).toHaveCount(0)
})
