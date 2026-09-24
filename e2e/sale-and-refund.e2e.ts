import { expect, test } from '@playwright/test'
import { createProduct, pinStoreCurrency, stockOf, uniq } from '../test/helpers/integration'
import { newSession } from './helpers'

// Money assertions below expect two decimals; the seed defaults to COP (whole pesos).
let restoreCurrency: (() => Promise<void>) | undefined
test.beforeAll(async () => {
    restoreCurrency = await pinStoreCurrency('USD')
})
test.afterAll(async () => {
    await restoreCurrency?.()
})

test('a sale takes stock, a manager refunds it, the stock comes back', async ({ browser }) => {
    const product = await createProduct({ name: uniq('E2E Beer'), selling_price: 20, tax_rate: 0.1, stock: 10 })

    // ---- cashier rings up two units
    const till = await newSession(browser, 'cashier')
    await till.goto('/pos')
    await till.getByPlaceholder('Search by name, SKU, or barcode...').fill(product.name)
    const card = till.getByRole('button', { name: `Add ${product.name} to cart` })
    await card.click()
    await till.getByRole('button', { name: 'Increase quantity' }).click()
    await till.getByRole('button', { name: 'Confirm' }).click()
    // The cart is a floating bubble now: open it to see the sheet.
    await till.getByRole('button', { name: /^Cart:/ }).click()
    const cartSheet = till.getByRole('dialog', { name: /^Cart/ })
    await expect(cartSheet.getByText('Cart (1)')).toBeVisible()
    // 2 x 20.00 + 10 % tax = 44.00 (the figure shown is only a preview)
    await expect(cartSheet.getByText('Total', { exact: true }).locator('..')).toContainText('44.00')

    await cartSheet.getByRole('button', { name: 'Checkout' }).click()
    await till.getByRole('button', { name: 'Card' }).click()
    await till.getByRole('button', { name: 'Complete Order' }).click()
    const done = till.getByRole('dialog', { name: 'Sale completed' })
    await expect(done).toContainText(/ORD-\d{6}-\d{6}/)
    await expect(done).toContainText('44.00') // the total the SERVER computed
    // The bubble stays mounted and drops back to an empty cart once checkout clears it.
    await expect(till.locator('button[aria-label="Cart: 0 items, total $0.00"]')).toHaveCount(1)
    expect(await stockOf(product.id)).toBe(8)

    // ---- the cashier sees the order but cannot refund it
    await done.getByRole('button', { name: 'View order' }).click()
    await expect(till.getByRole('heading', { name: 'Order Details' })).toBeVisible()
    // Scoped: the print-only <ReceiptTicket> (always mounted, hidden on screen) repeats the product name too.
    const detailView = till.getByTestId('order-detail-view')
    await expect(detailView.getByText(product.name)).toBeVisible()
    await expect(till.getByRole('button', { name: 'Refund' })).toHaveCount(0)
    const orderUrl = till.url()

    // ---- print preview: the 80mm ticket shows up, the normal view and the app shell are hidden
    await till.emulateMedia({ media: 'print' })
    await expect(till.locator('[data-testid="receipt-ticket"]')).toBeVisible()
    await expect(till.getByRole('heading', { name: 'Order Details' })).toBeHidden()
    await expect(till.locator('[data-slot="sidebar"]')).toBeHidden()
    await till.emulateMedia({ media: 'screen' })

    // ---- a manager refunds it
    const office = await newSession(browser, 'manager')
    await office.goto(orderUrl)
    await office.getByRole('button', { name: 'Refund' }).click()
    await office.getByRole('button', { name: 'Refund order' }).click() // no reason yet
    await expect(office.getByText('A reason is required')).toBeVisible()
    await office.getByLabel('Reason *').fill('Customer returned the goods')
    await office.getByRole('button', { name: 'Refund order' }).click()
    await expect(office.getByText('Customer returned the goods')).toBeVisible()
    await expect(office.getByRole('button', { name: 'Refund' })).toHaveCount(0)
    expect(await stockOf(product.id)).toBe(10)

    // ---- and the inventory screen agrees
    await office.goto('/inventory')
    await office.getByPlaceholder('Search by product name or SKU...').fill(product.name)
    await expect(office.getByRole('row', { name: new RegExp(product.name) })).toContainText('10')
})

test('a manager adjusts stock with a reason, and cannot take it below zero', async ({ browser }) => {
    const product = await createProduct({ name: uniq('E2E Adjust'), stock: 3 })
    const page = await newSession(browser, 'manager')
    await page.goto('/inventory')
    await page.getByPlaceholder('Search by product name or SKU...').fill(product.name)
    await page.getByRole('button', { name: `Adjust stock of ${product.name}` }).click()

    await page.getByLabel('Change (units) *').fill('-5')
    await page.getByLabel('Reason *').fill('Recount')
    await page.getByRole('button', { name: 'Apply adjustment' }).click()
    await expect(page.locator('[data-sonner-toast]').first()).toContainText('would make the stock negative')
    expect(await stockOf(product.id)).toBe(3)

    await page.getByLabel('Change (units) *').fill('12')
    await page.getByRole('button', { name: 'Apply adjustment' }).click()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'stock is now' })).toBeVisible()
    expect(await stockOf(product.id)).toBe(15)
})
