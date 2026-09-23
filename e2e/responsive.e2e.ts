import { expect, test, type Page } from '@playwright/test'
import { createProduct, pinStoreCurrency, uniq } from '../test/helpers/integration'
import { newSession } from './helpers'

const ADMIN_ROUTES = [
    '/dashboard',
    '/pos',
    '/orders',
    '/customers',
    '/products',
    '/categories',
    '/promotions',
    '/inventory',
    '/suppliers',
    '/reports',
    '/settings',
    '/users',
    '/audit'
]
const CASHIER_ROUTES = ['/dashboard', '/pos', '/orders', '/customers', '/products', '/categories', '/inventory']
const VIEWPORTS = [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
]

async function hasNoHorizontalScroll(page: Page) {
    return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
}

test.describe('no route causes horizontal scroll', () => {
    for (const role of ['admin', 'cashier'] as const) {
        const routes = role === 'admin' ? ADMIN_ROUTES : CASHIER_ROUTES
        for (const viewport of VIEWPORTS) {
            test(`${role} · ${viewport.width}px`, async ({ browser }) => {
                const page = await newSession(browser, role)
                await page.setViewportSize(viewport)
                for (const route of routes) {
                    await page.goto(route)
                    await expect
                        .poll(() => hasNoHorizontalScroll(page), { message: `horizontal scroll on ${route}` })
                        .toBe(true)
                }
            })
        }
    }
})

test.describe('mobile shell', () => {
    test.use({ viewport: { width: 375, height: 812 } })

    test('the bottom nav is visible, More opens the full menu, and navigating closes it', async ({ browser }) => {
        const page = await newSession(browser, 'cashier')
        const bottomNav = page.getByRole('navigation', { name: 'Mobile navigation' })
        await expect(bottomNav).toBeVisible()

        await bottomNav.getByRole('button', { name: 'More' }).click()
        const sidebar = page.locator('[data-slot="sidebar"][data-mobile="true"]')
        await expect(sidebar).toBeVisible()

        // Customers is on the cashier's nav but is not one of the 4 bottom tabs.
        await sidebar.getByRole('link', { name: 'Customers' }).click()
        await expect(page).toHaveURL(/\/customers$/)
        await expect(sidebar).toBeHidden()
    })

    test('the FAB opens the add dialog as a bottom sheet', async ({ browser }) => {
        const page = await newSession(browser, 'admin')
        await page.goto('/categories')
        await page.getByRole('button', { name: 'Add Category' }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const box = await dialog.boundingBox()
        expect(box).not.toBeNull()
        // A bottom sheet is pinned to the bottom edge of the viewport, not vertically centered.
        expect(box!.y + box!.height).toBeGreaterThan(700)
    })

    test('the avatar opens the account menu', async ({ browser }) => {
        const page = await newSession(browser, 'cashier')
        await page.locator('header').getByRole('button', { name: 'Account menu' }).click()
        await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    })

    test('a full sale can be completed from the POS on mobile', async ({ browser }) => {
        const restoreCurrency = await pinStoreCurrency('USD')
        try {
            const product = await createProduct({ name: uniq('E2E Mobile Beer'), selling_price: 15, stock: 5 })
            const page = await newSession(browser, 'cashier')
            await page.goto('/pos')
            await page.getByPlaceholder('Search by name, SKU, or barcode...').fill(product.name)
            await page.getByRole('button', { name: `Add ${product.name} to cart` }).click()
            await page.getByRole('button', { name: 'Confirm' }).click()
            await page.getByRole('button', { name: /^Cart:/ }).click()
            const cartSheet = page.getByRole('dialog', { name: /^Cart/ })
            await cartSheet.getByRole('button', { name: 'Checkout' }).click()
            await page.getByRole('button', { name: 'Card' }).click()
            await page.getByRole('button', { name: 'Complete Order' }).click()
            await expect(page.locator('[data-sonner-toast]').first()).toContainText(/Order ORD-\d{6}-\d{6} completed/)
        } finally {
            await restoreCurrency()
        }
    })
})

test.describe('desktop shell', () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test('the sidebar collapses to icons and there is no bottom nav', async ({ browser }) => {
        const page = await newSession(browser, 'admin')
        await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden()

        const sidebar = page.locator('[data-slot="sidebar"]')
        await expect(sidebar).toHaveAttribute('data-state', 'expanded')
        await page.getByRole('button', { name: 'Toggle sidebar' }).click()
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    })
})
