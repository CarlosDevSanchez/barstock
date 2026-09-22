import { beforeAll, describe, expect, test } from 'bun:test'
import { DELETE as deleteCategory, PATCH as patchCategory } from '@/app/api/v1/categories/[id]/route'
import { GET as listCategories, POST as createCategory } from '@/app/api/v1/categories/route'
import { GET as getCustomer, PATCH as patchCustomer } from '@/app/api/v1/customers/[id]/route'
import { GET as listCustomers, POST as createCustomer } from '@/app/api/v1/customers/route'
import { DELETE as deleteProduct, GET as getProduct, PATCH as patchProduct } from '@/app/api/v1/products/[id]/route'
import { GET as listProducts, POST as createProduct } from '@/app/api/v1/products/route'
import { GET as getSupplier, PATCH as patchSupplier } from '@/app/api/v1/suppliers/[id]/route'
import { GET as listSuppliers, POST as createSupplier } from '@/app/api/v1/suppliers/route'
import { adminClient, createProduct as makeProduct, ensureTestUsers, uniq } from '../helpers/integration'
import { dataOf, errorOf, loginAs, TestClient, type ApiResponse } from '../helpers/http'

let cashier: TestClient
let manager: TestClient
let admin: TestClient

beforeAll(async () => {
    await ensureTestUsers()
    ;[cashier, manager, admin] = await Promise.all([loginAs('cashier'), loginAs('manager'), loginAs('admin')])
})

const list = <T>(response: ApiResponse) => response.json<{ data: T[]; page: number; pageSize: number; total: number }>()

describe('products', () => {
    test('every endpoint requires a session', async () => {
        const anonymous = new TestClient()
        expect((await anonymous.get(listProducts, 'products')).status).toBe(401)
        expect((await anonymous.post(createProduct, 'products', { body: {} })).status).toBe(401)
    })

    test('cashiers read the catalog but cannot write it', async () => {
        const product = await makeProduct({ stock: 5 })
        const params = { id: product.id }
        expect((await cashier.get(listProducts, 'products')).status).toBe(200)
        expect((await cashier.get(getProduct, `products/${product.id}`, { params })).status).toBe(200)
        expect(
            (await cashier.post(createProduct, 'products', { body: { name: 'x', sku: uniq('S'), selling_price: 1 } }))
                .status
        ).toBe(403)
        expect(
            (await cashier.patch(patchProduct, `products/${product.id}`, { params, body: { name: 'hacked' } })).status
        ).toBe(403)
        expect((await cashier.delete(deleteProduct, `products/${product.id}`, { params })).status).toBe(403)
        const { data } = await adminClient().from('products').select('name').eq('id', product.id).single()
        expect(data?.name).toBe(product.name)
    })

    test("a manager creates products; '' becomes null so a second product without barcode is fine", async () => {
        const body = (sku: string) => ({
            name: uniq('P'),
            sku,
            barcode: '',
            category_id: '',
            selling_price: '3.50',
            cost_price: '1',
            tax_rate: 0.07
        })
        const first = await manager.post(createProduct, 'products', { body: body(uniq('A')) })
        const second = await manager.post(createProduct, 'products', { body: body(uniq('B')) })
        expect(first.status).toBe(201)
        expect(second.status).toBe(201)
        expect(
            dataOf<{ barcode: string | null; category_id: string | null; selling_price: number }>(first)
        ).toMatchObject({
            barcode: null,
            category_id: null,
            selling_price: 3.5
        })
    })

    test('a new product gets its inventory row automatically (stock 0)', async () => {
        const created = dataOf<{ id: string }>(
            await manager.post(createProduct, 'products', {
                body: { name: uniq('P'), sku: uniq('S'), selling_price: 2 }
            })
        )
        const { data } = await adminClient().from('inventory').select('quantity').eq('product_id', created.id).single()
        expect(data?.quantity).toBe(0)
    })

    test('duplicate SKU is a 409 that does not leak the constraint name', async () => {
        const sku = uniq('DUP')
        await manager.post(createProduct, 'products', { body: { name: 'a', sku, selling_price: 1 } })
        const response = await manager.post(createProduct, 'products', { body: { name: 'b', sku, selling_price: 1 } })
        expect(response.status).toBe(409)
        expect(response.text).not.toMatch(/products_sku_key|duplicate key/)
    })

    test('validation errors are 422 with per-field details', async () => {
        const response = await manager.post(createProduct, 'products', {
            body: { name: '', sku: '', selling_price: -1 }
        })
        expect(response.status).toBe(422)
        const paths = (errorOf(response).details as Array<{ path: string }>).map(detail => detail.path)
        expect(paths).toEqual(expect.arrayContaining(['name', 'sku', 'selling_price']))
    })

    test('unknown or server-owned fields in the body are ignored, not written', async () => {
        const response = await manager.post(createProduct, 'products', {
            body: {
                name: uniq('P'),
                sku: uniq('S'),
                selling_price: 1,
                id: crypto.randomUUID(),
                created_at: '2001-01-01',
                deleted_at: '2001-01-01'
            }
        })
        const product = dataOf<{ id: string; created_at: string; deleted_at: string | null }>(response)
        expect(product.deleted_at).toBeNull()
        expect(product.created_at.startsWith('2001')).toBe(false)
    })

    test('PATCH only changes what was sent', async () => {
        const product = await makeProduct({ cost_price: 4, selling_price: 10, tax_rate: 0.1 })
        const response = await manager.patch(patchProduct, `products/${product.id}`, {
            params: { id: product.id },
            body: { name: 'Renamed' }
        })
        expect(
            dataOf<{ name: string; selling_price: number; tax_rate: number; cost_price: number }>(response)
        ).toMatchObject({
            name: 'Renamed',
            selling_price: 10,
            tax_rate: 0.1,
            cost_price: 4
        })
    })

    test('unknown ids are 404 and malformed ids 422', async () => {
        const missing = crypto.randomUUID()
        expect((await manager.get(getProduct, `products/${missing}`, { params: { id: missing } })).status).toBe(404)
        expect(
            (await manager.patch(patchProduct, `products/${missing}`, { params: { id: missing }, body: { name: 'x' } }))
                .status
        ).toBe(404)
        expect((await manager.get(getProduct, 'products/not-a-uuid', { params: { id: 'not-a-uuid' } })).status).toBe(
            422
        )
    })

    test('deleting is a soft delete: gone for everyone in the API, history kept', async () => {
        const product = await makeProduct()
        const params = { id: product.id }
        expect((await manager.delete(deleteProduct, `products/${product.id}`, { params })).status).toBe(204)
        expect((await manager.get(getProduct, `products/${product.id}`, { params })).status).toBe(404)
        expect((await manager.delete(deleteProduct, `products/${product.id}`, { params })).status).toBe(404)
        const search = await cashier.get(listProducts, 'products', { headers: {}, origin: null })
        expect(list<{ id: string }>(search).data.some(row => row.id === product.id)).toBe(false)
        const { data } = await adminClient()
            .from('products')
            .select('deleted_at, is_active')
            .eq('id', product.id)
            .single()
        expect(data?.deleted_at).not.toBeNull()
        expect(data?.is_active).toBe(false)
    })

    test('lists paginate, search by name/SKU/barcode and expose live stock', async () => {
        const tag = uniq('findme')
        const products = await Promise.all([
            makeProduct({ name: `${tag} alpha`, stock: 7 }),
            makeProduct({ name: `${tag} beta`, barcode: uniq('BC') }),
            makeProduct({ name: `${tag} gamma` })
        ])
        const result = list<{ id: string; stock: number | null }>(
            await cashier.get(listProducts, `products?q=${tag}&pageSize=2&page=1`)
        )
        expect(result.total).toBe(3)
        expect(result.data).toHaveLength(2)
        const second = list<{ id: string }>(await cashier.get(listProducts, `products?q=${tag}&pageSize=2&page=2`))
        expect(second.data).toHaveLength(1)

        const alpha = list<{ id: string; stock: number | null }>(
            await cashier.get(listProducts, `products?q=${tag}%20alpha`)
        )
        expect(alpha.data[0]).toMatchObject({ id: products[0].id, stock: 7 })

        const ids = products.map(product => product.id).join(',')
        expect(list(await cashier.get(listProducts, `products?ids=${ids}`)).total).toBe(3)
    })

    test('the search cannot be used to inject PostgREST filters', async () => {
        await makeProduct({ name: uniq('victim') })
        const response = await cashier.get(listProducts, `products?q=${encodeURIComponent('x),sku.neq.zzz,(y')}`)
        expect(response.status).toBe(200)
        expect(list(response).total).toBe(0)
        // "%" is stripped, so it behaves like no filter at all instead of being a LIKE wildcard.
        const everything = list(await cashier.get(listProducts, 'products')).total
        expect(list(await cashier.get(listProducts, `products?q=${encodeURIComponent('%')}`)).total).toBe(everything)
        expect((await cashier.get(listProducts, 'products?pageSize=1000')).status).toBe(422)
    })
})

describe('categories', () => {
    test('cashiers read; managers create, rename and delete; a category in use cannot be deleted', async () => {
        expect((await cashier.get(listCategories, 'categories')).status).toBe(200)
        expect((await cashier.post(createCategory, 'categories', { body: { name: uniq('C') } })).status).toBe(403)

        const created = await manager.post(createCategory, 'categories', {
            body: { name: uniq('Cat'), description: '' }
        })
        expect(created.status).toBe(201)
        const category = dataOf<{ id: string; description: string | null }>(created)
        expect(category.description).toBeNull()

        const renamed = await manager.patch(patchCategory, `categories/${category.id}`, {
            params: { id: category.id },
            body: { name: 'Renamed' }
        })
        expect(dataOf<{ name: string }>(renamed).name).toBe('Renamed')

        await makeProduct({ category_id: category.id })
        const inUse = await manager.delete(deleteCategory, `categories/${category.id}`, { params: { id: category.id } })
        expect(inUse.status).toBe(409)

        const empty = dataOf<{ id: string }>(
            await manager.post(createCategory, 'categories', { body: { name: uniq('Empty') } })
        )
        expect(
            (await manager.delete(deleteCategory, `categories/${empty.id}`, { params: { id: empty.id } })).status
        ).toBe(204)
        expect(
            (await manager.delete(deleteCategory, `categories/${empty.id}`, { params: { id: empty.id } })).status
        ).toBe(404)
    })

    test('the list carries the product count', async () => {
        const category = dataOf<{ id: string; name: string }>(
            await manager.post(createCategory, 'categories', { body: { name: uniq('Counted') } })
        )
        await makeProduct({ category_id: category.id })
        await makeProduct({ category_id: category.id })
        const rows = list<{ id: string; product_count: number }>(
            await cashier.get(listCategories, `categories?q=${category.name}`)
        ).data
        expect(rows.find(row => row.id === category.id)?.product_count).toBe(2)
    })
})

describe('customers', () => {
    test('any signed-in user manages customers; blank email becomes null (so several are allowed)', async () => {
        for (const client of [cashier, manager]) {
            const response = await client.post(createCustomer, 'customers', {
                body: { name: uniq('Cu'), email: '', phone: '' }
            })
            expect(response.status).toBe(201)
            expect(dataOf<{ email: string | null }>(response).email).toBeNull()
        }
    })

    test('loyalty points and total spent are derived: a client cannot set them', async () => {
        const created = await cashier.post(createCustomer, 'customers', {
            body: { name: uniq('Cu'), total_spent: 1_000_000, loyalty_points: 99_999 }
        })
        expect(dataOf<{ total_spent: number; loyalty_points: number }>(created)).toMatchObject({
            total_spent: 0,
            loyalty_points: 0
        })
        const id = dataOf<{ id: string }>(created).id
        const patched = await cashier.patch(patchCustomer, `customers/${id}`, {
            params: { id },
            body: { name: 'Renamed', total_spent: 5 }
        })
        expect(dataOf<{ name: string; total_spent: number }>(patched)).toMatchObject({
            name: 'Renamed',
            total_spent: 0
        })
    })

    test('duplicate email is a 409; lookup and search work', async () => {
        const email = `${uniq('dup')}@example.com`
        expect((await cashier.post(createCustomer, 'customers', { body: { name: 'a', email } })).status).toBe(201)
        expect(
            (await cashier.post(createCustomer, 'customers', { body: { name: 'b', email: email.toUpperCase() } }))
                .status
        ).toBe(409)
        const found = list<{ email: string }>(await cashier.get(listCustomers, `customers?q=${email}`))
        expect(found.total).toBe(1)
        const id = crypto.randomUUID()
        expect((await cashier.get(getCustomer, `customers/${id}`, { params: { id } })).status).toBe(404)
    })
})

describe('suppliers', () => {
    test('managers and admins only', async () => {
        expect((await cashier.get(listSuppliers, 'suppliers')).status).toBe(403)
        expect((await cashier.post(createSupplier, 'suppliers', { body: { name: 'x' } })).status).toBe(403)

        for (const client of [manager, admin]) {
            const created = await client.post(createSupplier, 'suppliers', {
                body: { name: uniq('Sup'), email: '', phone: '555' }
            })
            expect(created.status).toBe(201)
            const id = dataOf<{ id: string }>(created).id
            expect((await client.get(getSupplier, `suppliers/${id}`, { params: { id } })).status).toBe(200)
            const updated = await client.patch(patchSupplier, `suppliers/${id}`, {
                params: { id },
                body: { contact_person: 'Ann' }
            })
            expect(dataOf<{ contact_person: string; phone: string }>(updated)).toMatchObject({
                contact_person: 'Ann',
                phone: '555'
            })
        }
    })
})
