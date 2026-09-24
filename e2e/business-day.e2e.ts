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
    await expect(page.getByText('Expected cash')).toBeVisible()

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
    await count.getByLabel('Counted cash').fill('120')
    await expect(count.getByText('Difference')).toBeVisible()
    await count.getByRole('button', { name: 'Count', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Count', exact: true })).toHaveCount(0)
})
