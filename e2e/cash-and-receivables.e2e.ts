import { expect, test } from '@playwright/test'
import {
    adminClient,
    createCustomer,
    createProduct,
    createSupplier,
    ensureTestUsers,
    pinStoreCurrency,
    signedInClient,
    stockOf,
    uniq,
    type Db
} from '../test/helpers/integration'
import { newSession } from './helpers'

/** Phase E RPC arg shapes are not always exact in generated types; same loose-cast pattern as receivables.test.ts. */
function rpc(client: Db, fn: string, args: Record<string, unknown>) {
    return (
        client as unknown as {
            rpc: (
                f: string,
                a: Record<string, unknown>
            ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
        }
    ).rpc(fn, args)
}

// Money assertions below expect two decimals; the seed defaults to COP (whole pesos).
let restoreCurrency: (() => Promise<void>) | undefined
test.beforeAll(async () => {
    await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
})
test.afterAll(async () => {
    await restoreCurrency?.()
})

// Same reset as e2e/business-day.e2e.ts: force-close any open business day/till left over from a previous run so
// each test starts from a clean "no day open" state.
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

test('a split-payment sale can be completed and printed', async ({ browser }) => {
    const product = await createProduct({ name: uniq('E2E Split'), selling_price: 20, tax_rate: 0, stock: 5 })
    const till = await newSession(browser, 'cashier')
    await till.goto('/pos')
    await till.getByPlaceholder('Search by name, SKU, or barcode...').fill(product.name)
    await till.getByRole('button', { name: `Add ${product.name} to cart` }).click()
    await till.getByRole('button', { name: 'Confirm' }).click()
    await till.getByRole('button', { name: /^Cart:/ }).click()
    const cartSheet = till.getByRole('dialog', { name: /^Cart/ })
    await cartSheet.getByRole('button', { name: 'Checkout' }).click()

    const payDialog = till.getByRole('dialog', { name: 'Complete Payment' })
    await payDialog.getByRole('button', { name: 'Split payment' }).click()
    // Default split: first leg keeps the cart's payment method (cash), second leg defaults to card.
    await payDialog.getByLabel('Payment Method Amount').fill('8')
    // The second amount auto-completes to the remainder (20 - 8 = 12); leave it untouched.
    await expect(payDialog.getByLabel('Second payment Amount')).toHaveValue('12.00')

    await payDialog.getByRole('button', { name: 'Complete Order' }).click()
    const done = till.getByRole('dialog', { name: 'Sale completed' })
    await expect(done).toContainText(/ORD-\d{6}-\d{6}/)
    await expect(done).toContainText('20.00')

    await done.getByRole('button', { name: 'View order' }).click()
    await expect(till.getByRole('heading', { name: 'Order Details' })).toBeVisible()

    // Printed 80mm ticket (#print-root) shows up under print media; the normal view and app shell hide.
    await till.emulateMedia({ media: 'print' })
    await expect(till.locator('[data-testid="receipt-ticket"]')).toBeVisible()
    await expect(till.getByRole('heading', { name: 'Order Details' })).toBeHidden()
    await till.emulateMedia({ media: 'screen' })

    expect(await stockOf(product.id)).toBe(4)
})

test('registering a cash expense lowers the expected cash of the till it is paid from', async ({ browser }) => {
    const office = await newSession(browser, 'manager')
    await office.goto('/cash')
    await office.getByRole('button', { name: 'Open business day' }).click()
    await expect(office.getByRole('button', { name: 'Open till' })).toBeVisible()
    await office.getByLabel('Float').fill('100')
    await office.getByRole('button', { name: 'Open till' }).click()
    // Manager (not blind-counted): sees the live expected cash right after opening.
    await expect(office.getByText('Expected cash: $100.00')).toBeVisible()

    await office.goto('/expenses')
    await office.getByRole('button', { name: 'Add expense' }).click()
    const dialog = office.getByRole('dialog', { name: 'Add expense' })
    await dialog.locator('#new-description').fill(uniq('E2E rent'))
    await dialog.locator('#new-amount').fill('15')
    await dialog.getByLabel('Paid with cash from the till').check()
    await dialog.getByRole('button', { name: 'Save expense' }).click()
    await expect(office.locator('[data-sonner-toast]').filter({ hasText: 'Expense recorded' })).toBeVisible()

    await office.goto('/cash')
    await expect(office.getByText('Expected cash: $85.00')).toBeVisible()
})

test('receiving a purchase raises stock, and a deferred tab appears in receivables until paid', async ({ browser }) => {
    // ---- purchase raises stock (E5: the supplier/product pickers search the API instead of a flat pageSize:100)
    const supplier = await createSupplier({ name: uniq('E2E Supplier') })
    const product = await createProduct({ name: uniq('E2E Restock'), stock: 5 })
    const inv = await newSession(browser, 'manager')
    await inv.goto('/inventory')
    await inv.getByPlaceholder('Search by product name or SKU...').fill(product.name)
    await inv.getByRole('button', { name: `Adjust stock of ${product.name}` }).click()
    await inv.getByLabel('Change (units) *').fill('10')
    await inv.getByRole('button', { name: 'Supplier intake' }).click()
    await inv.locator('#adj-supplier-search').fill(supplier.name)
    await expect(inv.locator('#adj-supplier')).toContainText(supplier.name)
    await inv.getByRole('button', { name: 'Save purchase' }).click()
    await expect(inv.locator('[data-sonner-toast]').filter({ hasText: 'Purchase recorded' })).toBeVisible()
    expect(await stockOf(product.id)).toBe(15)

    // ---- defer a tab, it shows up in /receivables, paying it makes it disappear
    const customer = await createCustomer({ name: uniq('E2E Customer') })
    const tabProduct = await createProduct({ name: uniq('E2E Tab'), selling_price: 30, tax_rate: 0, stock: 5 })
    const cashier: Db = await signedInClient('cashier')
    const opened = await rpc(cashier, 'open_tab', {
        p_label: uniq('E2E Recv'),
        p_customer_id: customer.id,
        p_members: []
    })
    if (opened.error) throw opened.error
    const tabId = opened.data as string
    const added = await rpc(cashier, 'tab_add_items', {
        p_tab_id: tabId,
        p_items: [{ product_id: tabProduct.id, quantity: 1 }]
    })
    if (added.error) throw added.error
    const deferred = await rpc(cashier, 'defer_tab', {
        p_tab_id: tabId,
        p_due_date: '2099-01-15',
        p_reminder: false,
        p_note: null
    })
    if (deferred.error) throw deferred.error

    const recv = await newSession(browser, 'manager')
    await recv.goto('/receivables')
    const row = recv.getByRole('row', { name: new RegExp(customer.name) })
    await expect(row).toBeVisible()
    await expect(row).toContainText('30.00')

    await row.getByRole('button', { name: 'Record payment' }).click()
    const payDialog = recv.getByRole('dialog', { name: 'Record payment' })
    await payDialog.getByRole('button', { name: 'Record payment' }).click()
    await expect(recv.locator('[data-sonner-toast]').filter({ hasText: 'Payment recorded' })).toBeVisible()
    await expect(recv.getByRole('row', { name: new RegExp(customer.name) })).toHaveCount(0)
})
