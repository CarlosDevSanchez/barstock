import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { page, product, settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'
import { ApiError } from '@/lib/api/client'

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

const renderPage = (role: 'cashier' | 'manager', storeSettings = settings) =>
    render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole(role), settings: storeSettings }}>
                <ProductsPage />
            </SessionProvider>
        </IntlProvider>
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

    test('a new product starts with the store default tax rate from Settings', async () => {
        renderPage('manager', { ...settings, tax_rate: 0.0725 })
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: /Add Product/ }))
        await screen.findByRole('dialog')
        expect((screen.getByLabelText('Tax Rate (%)') as HTMLInputElement).value).toBe('7.25')
    })

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

describe('image picker visibility (storage_configured)', () => {
    test('shows the image picker when storage is configured (the default fixture)', async () => {
        renderPage('manager')
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: /Add Product/ }))
        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByRole('button', { name: 'Add Image' })).toBeTruthy()
    })

    test('hides the image picker when R2 is not configured, instead of letting someone pick a file that will 503', async () => {
        renderPage('manager', { ...settings, storage_configured: false })
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: /Add Product/ }))
        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).queryByRole('button', { name: 'Add Image' })).toBeNull()
        expect(within(dialog).queryByRole('button', { name: 'Change Image' })).toBeNull()
    })
})

describe('SKU suggestion', () => {
    const openNewProduct = async () => {
        renderPage('manager')
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: /Add Product/ }))
        return screen.findByRole('dialog')
    }

    test('the SKU autofills from the name while creating a product', async () => {
        await openNewProduct()
        type('Product Name *', 'Cerveza Club Colombia 330ml')
        expect((screen.getByLabelText('SKU *') as HTMLInputElement).value).toBe('CER-CLU-COL-330ML')
    })

    test('autofill stops once the SKU has been edited by hand', async () => {
        await openNewProduct()
        type('Product Name *', 'Cerveza Club')
        expect((screen.getByLabelText('SKU *') as HTMLInputElement).value).toBe('CER-CLU')

        type('SKU *', 'CUSTOM-SKU')
        type('Product Name *', 'Cerveza Club Colombia')
        expect((screen.getByLabelText('SKU *') as HTMLInputElement).value).toBe('CUSTOM-SKU')
    })

    test('the Regenerate button re-derives the SKU from the current name and resumes autofill', async () => {
        const dialog = await openNewProduct()
        type('Product Name *', 'Cerveza Club')
        type('SKU *', 'CUSTOM-SKU')

        fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }))
        expect((screen.getByLabelText('SKU *') as HTMLInputElement).value).toBe('CER-CLU')

        type('Product Name *', 'Cerveza Club Colombia')
        expect((screen.getByLabelText('SKU *') as HTMLInputElement).value).toBe('CER-CLU-COL')
    })

    test('editing an existing product never autofills the SKU when the name changes', async () => {
        renderPage('manager')
        await screen.findByText('Wireless Mouse')
        fireEvent.click(screen.getByRole('button', { name: 'Edit Wireless Mouse' }))
        await screen.findByRole('dialog')

        expect((screen.getByLabelText('SKU *') as HTMLInputElement).value).toBe('ELEC-001')
        type('Product Name *', 'Something Completely Different')
        expect((screen.getByLabelText('SKU *') as HTMLInputElement).value).toBe('ELEC-001')
    })

    test('a duplicate SKU (409) surfaces as a field error with a "-2" suggestion', async () => {
        create.mockImplementationOnce(async () => {
            throw new ApiError(409, 'conflict', 'A record with the same unique value already exists')
        })
        const dialog = await openNewProduct()
        type('Product Name *', 'Widget')
        type('SKU *', 'W-1')
        type('Cost Price *', '4')
        type('Selling Price *', '9.5')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create Product' }))

        expect(await within(dialog).findByText('This SKU is already in use. Try "W-1-2".')).toBeTruthy()
        expect(within(dialog).getByText('Add New Product')).toBeTruthy() // dialog stayed open
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
