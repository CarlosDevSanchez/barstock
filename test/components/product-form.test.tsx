import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { page, product, settings, userWithRole } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react')

const existing = product({
    id: 'p-1',
    name: 'Wireless Mouse',
    sku: 'ELEC-001',
    cost_price: 15,
    selling_price: 29.99,
    tax_rate: 0.0725
})
const create = mock(async (body: unknown) => ({ id: 'new', ...(body as object) }))
const update = mock(async (_id: string, body: unknown) => ({ id: 'p-1', ...(body as object) }))
const remove = mock(async () => {})

void mock.module('@/lib/api/products', () => ({
    productsApi: { list: async () => page([existing]), create, update, remove }
}))
void mock.module('@/lib/api/categories', () => ({
    categoriesApi: { list: async () => page([{ id: 'c-1', name: 'Electronics', description: null, product_count: 1 }]) }
}))
void mock.module('next/navigation', () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    usePathname: () => '/products'
}))

const { default: ProductsPage } = await import('@/app/(dashboard)/products/page')
const { SessionProvider } = await import('@/components/session-provider')

const renderPage = (role: 'cashier' | 'manager') =>
    render(
        <SessionProvider value={{ user: userWithRole(role), settings }}>
            <ProductsPage />
        </SessionProvider>
    )

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
    create.mockClear()
    update.mockClear()
    remove.mockClear()
})
afterEach(cleanup)

describe('who can edit the catalog', () => {
    test('a cashier only browses: no add, edit or delete controls and no cost column', async () => {
        renderPage('cashier')
        await screen.findByText('Wireless Mouse')
        expect(screen.queryByRole('button', { name: /Add Product/ })).toBeNull()
        expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
        expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()
        expect(screen.queryByText('Cost')).toBeNull()
    })

    test('a manager sees the controls and the cost', async () => {
        renderPage('manager')
        await screen.findByText('Wireless Mouse')
        expect(screen.getByRole('button', { name: /Add Product/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Edit Wireless Mouse' })).toBeTruthy()
        expect(screen.getByText('Cost')).toBeTruthy()
    })
})

describe('product form validation', () => {
    const openNewProduct = async () => {
        renderPage('manager')
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: /Add Product/ }))
        return screen.findByRole('dialog')
    }

    test('submitting an empty form shows readable errors and sends nothing', async () => {
        const dialog = await openNewProduct()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create Product' }))

        expect(await within(dialog).findAllByText('Required')).toHaveLength(4) // name, sku, cost price, selling price
        expect(within(dialog).queryByText(/expected number|Invalid input/)).toBeNull()
        expect(create).not.toHaveBeenCalled()
    })

    test('rejects a negative price and a tax rate over 100 %', async () => {
        const dialog = await openNewProduct()
        type('Product Name *', 'Widget')
        type('SKU *', 'W-1')
        type('Cost Price *', '-1')
        type('Selling Price *', '5')
        type('Tax Rate (%)', '150')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create Product' }))

        expect(await within(dialog).findByText('Must be 0 or more')).toBeTruthy()
        expect(within(dialog).getByText('Must be at most 100 %')).toBeTruthy()
        expect(create).not.toHaveBeenCalled()
    })

    test('a valid form is normalized: tax percent -> fraction, blank optional fields -> null, prices -> numbers', async () => {
        const dialog = await openNewProduct()
        type('Product Name *', '  Widget  ')
        type('SKU *', 'W-1')
        type('Cost Price *', '4')
        type('Selling Price *', '9.5')
        type('Tax Rate (%)', '7.25')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create Product' }))

        await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
        expect(create.mock.calls[0]?.[0]).toMatchObject({
            name: 'Widget',
            sku: 'W-1',
            cost_price: 4,
            selling_price: 9.5,
            tax_rate: 0.0725,
            barcode: null,
            description: null,
            category_id: null
        })
    })

    test('editing starts from the stored values (tax shown as a percentage) and PATCHes', async () => {
        renderPage('manager')
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: 'Edit Wireless Mouse' }))
        const dialog = await screen.findByRole('dialog')

        expect((screen.getByLabelText('Tax Rate (%)') as HTMLInputElement).value).toBe('7.25')
        expect((screen.getByLabelText('Selling Price *') as HTMLInputElement).value).toBe('29.99')
        type('Selling Price *', '31')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Update Product' }))

        await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
        expect(update.mock.calls[0]?.[0]).toBe('p-1')
        expect(update.mock.calls[0]?.[1]).toMatchObject({ selling_price: 31, tax_rate: 0.0725 })
    })
})

describe('deleting', () => {
    test('asks for confirmation first and only then deletes', async () => {
        renderPage('manager')
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: 'Delete Wireless Mouse' }))

        const dialog = await screen.findByRole('alertdialog')
        expect(within(dialog).getByText('Delete product?')).toBeTruthy()
        expect(remove).not.toHaveBeenCalled()

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(remove).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Delete Wireless Mouse' }))
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
        await waitFor(() => expect(remove).toHaveBeenCalledWith('p-1'))
    })
})
