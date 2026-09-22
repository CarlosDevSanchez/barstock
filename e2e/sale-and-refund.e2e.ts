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
    await card.click()
    await expect(till.getByText('Cart (1)')).toBeVisible()
    // 2 x 20.00 + 10 % tax = 44.00 (the figure shown is only a preview)
    await expect(till.getByText('Total', { exact: true }).locator('..')).toContainText('44.00')

    await till.getByRole('button', { name: 'Checkout' }).click()
    await till.getByRole('button', { name: 'Card' }).click()
    await till.getByRole('button', { name: 'Complete Order' }).click()
    const toast = till.locator('[data-sonner-toast]').first()
    await expect(toast).toContainText(/Order ORD-\d{6}-\d{6} completed/)
    await expect(toast).toContainText('44.00') // the total the SERVER computed
    await expect(till.getByText('Cart (0)')).toBeVisible()
    expect(await stockOf(product.id)).toBe(8)

    // ---- the cashier sees the order but cannot refund it
    await toast.getByRole('button', { name: 'View order' }).click()
    await expect(till.getByRole('heading', { name: 'Order Details' })).toBeVisible()
    await expect(till.getByText(product.name)).toBeVisible()
    await expect(till.getByRole('button', { name: 'Refund' })).toHaveCount(0)
    const orderUrl = till.url()

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
