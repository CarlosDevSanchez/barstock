import { expect, test } from '@playwright/test'
import { adminClient, createProduct, ensureTestUsers, pinStoreCurrency, uniq } from '../test/helpers/integration'
import { newSession } from './helpers'

let restoreCurrency: (() => Promise<void>) | undefined
test.beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
})
test.afterAll(async () => {
    await restoreCurrency?.()
})

test.beforeEach(async () => {
    const admin = adminClient()
    const { data } = await admin.from('business_days').select('id').is('closed_at', null)
    const closedAt = new Date(Date.now() + 5000).toISOString()
    for (const day of data ?? []) {
        await admin
            .from('cash_sessions')
            .update({ status: 'closed', closed_at: closedAt })
            .eq('business_day_id', day.id)
            .eq('status', 'open')
        await admin.from('business_days').update({ closed_at: closedAt, close_kind: 'manual' }).eq('id', day.id)
    }
})

test('open a day and a till, sell, then close the till with a count', async ({ browser }) => {
    const product = await createProduct({ name: uniq('E2E Till'), selling_price: 20, tax_rate: 0, stock: 5 })
    const page = await newSession(browser, 'cashier')

    await page.goto('/cash')
    await page.getByRole('button', { name: 'Open business day' }).click()
    await expect(page.getByRole('button', { name: 'Open till' })).toBeVisible()
    await page.getByLabel('Float').fill('100')
    await page.getByRole('button', { name: 'Open till' }).click()
    // R-1: blind cash count — a cashier does not see the till's expected cash while it is open.
    await expect(page.getByText('Expected cash')).toHaveCount(0)

    await page.goto('/pos')
    await page.getByPlaceholder('Search by name, SKU, or barcode...').fill(product.name)
    await page.getByRole('button', { name: `Add ${product.name} to cart` }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await page.getByRole('button', { name: /^Cart:/ }).click()
    const cart = page.getByRole('dialog', { name: /^Cart/ })
    await cart.getByRole('button', { name: 'Checkout' }).click()
    await page.getByRole('button', { name: 'Complete Order' }).click()
    await expect(page.getByRole('dialog', { name: 'Sale completed' })).toBeVisible()

    await page.goto('/cash')
    await page.getByRole('button', { name: 'Count', exact: true }).click()
    const count = page.getByRole('dialog', { name: 'Count', exact: true })
    // R-1: no live "Expected"/"Difference" preview for a cashier before submitting the count.
    await expect(count.getByText('Expected cash')).toHaveCount(0)
    await count.getByLabel('Counted cash').fill('120')
    await expect(count.getByText('Difference')).toHaveCount(0)
    await count.getByRole('button', { name: 'Count', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Count', exact: true })).toHaveCount(0)
    // The cashier only learns the difference AFTER closing, via a toast.
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Difference' })).toBeVisible()
})
