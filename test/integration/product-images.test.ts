import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { DELETE as deleteProductImage, POST as uploadProductImage } from '@/app/api/v1/products/[id]/image/route'
import { GET as listProductsRoute } from '@/app/api/v1/products/route'
import { DELETE as deleteLogo, POST as uploadLogo } from '@/app/api/v1/settings/logo/route'
import {
    InMemoryStorage,
    MAX_IMAGE_BYTES,
    setStorageBackendForTesting,
    STORAGE_UNCONFIGURED_FOR_TESTING
} from '@/lib/server/storage'
import { adminClient, createProduct as makeProduct, ensureTestUsers } from '../helpers/integration'
import { dataOf, errorOf, loginAs, type TestClient } from '../helpers/http'

// Every test in this file swaps the real R2 backend for an in-memory one (`beforeEach`), so nothing here ever
// touches the network or a real bucket, and `storage.objects` lets us assert exactly what would have been
// written/deleted. `afterAll` restores the normal (unconfigured, in this worktree) behaviour for every other
// integration test file that shares this `bun test` process.

let cashier: TestClient
let manager: TestClient
let admin: TestClient
let storage: InMemoryStorage

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3, 4])
const jpegFile = (name = 'photo.jpg') => new File([JPEG_BYTES], name, { type: 'image/jpeg' })
const formWith = (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return formData
}

beforeAll(async () => {
    await ensureTestUsers()
    ;[cashier, manager, admin] = await Promise.all([loginAs('cashier'), loginAs('manager'), loginAs('admin')])
})

beforeEach(() => {
    storage = new InMemoryStorage()
    setStorageBackendForTesting(storage)
})

afterAll(() => {
    setStorageBackendForTesting(null)
})

describe('product image upload', () => {
    test('a manager uploads an image: the key is stored, a signed URL comes back, and it shows up in the list', async () => {
        const product = await makeProduct()
        const uploaded = await manager.post(uploadProductImage, `products/${product.id}/image`, {
            params: { id: product.id },
            formData: formWith(jpegFile())
        })
        expect(uploaded.status).toBe(200)
        const { image_url } = dataOf<{ image_url: string }>(uploaded)
        expect(image_url).toContain('/products/')
        expect(storage.objects.size).toBe(1)

        const { data } = await adminClient().from('products').select('image_key').eq('id', product.id).single()
        expect(data?.image_key).toMatch(/^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/)

        const list = await cashier.get(listProductsRoute, `products?q=${product.sku}`)
        const row = list
            .json<{ data: Array<{ id: string; image_url: string | null }> }>()
            .data.find(row => row.id === product.id)
        expect(row?.image_url).toBe(image_url)
    })

    test('a cashier cannot upload or delete an image (403)', async () => {
        const product = await makeProduct()
        expect(
            (
                await cashier.post(uploadProductImage, `products/${product.id}/image`, {
                    params: { id: product.id },
                    formData: formWith(jpegFile())
                })
            ).status
        ).toBe(403)
        expect(
            (
                await cashier.delete(deleteProductImage, `products/${product.id}/image`, {
                    params: { id: product.id }
                })
            ).status
        ).toBe(403)
        expect(storage.objects.size).toBe(0)
    })

    test('rejects a file over the 2 MB cap (413) and a non-image file (415); nothing is stored', async () => {
        const product = await makeProduct()
        const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
        big.set(JPEG_BYTES)
        const tooBig = await manager.post(uploadProductImage, `products/${product.id}/image`, {
            params: { id: product.id },
            formData: formWith(new File([big], 'big.jpg', { type: 'image/jpeg' }))
        })
        expect(tooBig.status).toBe(413)
        expect(errorOf(tooBig).code).toBe('payload_too_large')

        const notAnImage = await manager.post(uploadProductImage, `products/${product.id}/image`, {
            params: { id: product.id },
            // A renamed text file, claiming to be a JPEG in both its name and its Content-Type: validateImage only
            // trusts the magic bytes, which are absent here.
            formData: formWith(new File([new TextEncoder().encode('hello world')], 'fake.jpg', { type: 'image/jpeg' }))
        })
        expect(notAnImage.status).toBe(415)
        expect(errorOf(notAnImage).code).toBe('unsupported_media_type')
        expect(storage.objects.size).toBe(0)
    })

    test('replacing an image deletes the previous object (exactly one object survives)', async () => {
        const product = await makeProduct()
        const first = await manager.post(uploadProductImage, `products/${product.id}/image`, {
            params: { id: product.id },
            formData: formWith(jpegFile())
        })
        expect(first.status).toBe(200)
        expect(storage.objects.size).toBe(1)
        const keysAfterFirst = [...storage.objects.keys()]

        const second = await manager.post(uploadProductImage, `products/${product.id}/image`, {
            params: { id: product.id },
            formData: formWith(jpegFile('other.jpg'))
        })
        expect(second.status).toBe(200)
        expect(storage.objects.size).toBe(1)
        expect([...storage.objects.keys()]).not.toEqual(keysAfterFirst)
    })

    test('deleting removes the object and clears image_key', async () => {
        const product = await makeProduct()
        await manager.post(uploadProductImage, `products/${product.id}/image`, {
            params: { id: product.id },
            formData: formWith(jpegFile())
        })
        expect(storage.objects.size).toBe(1)

        const removed = await manager.delete(deleteProductImage, `products/${product.id}/image`, {
            params: { id: product.id }
        })
        expect(removed.status).toBe(200)
        expect(dataOf<{ image_url: null }>(removed).image_url).toBeNull()
        expect(storage.objects.size).toBe(0)

        const { data } = await adminClient().from('products').select('image_key').eq('id', product.id).single()
        expect(data?.image_key).toBeNull()
    })

    test('an unknown product is 404, and nothing is uploaded', async () => {
        const missing = crypto.randomUUID()
        const response = await manager.post(uploadProductImage, `products/${missing}/image`, {
            params: { id: missing },
            formData: formWith(jpegFile())
        })
        expect(response.status).toBe(404)
        expect(storage.objects.size).toBe(0)
    })

    test('without the 4 R2 env vars, the endpoint answers 503 storage_not_configured', async () => {
        const product = await makeProduct()
        // The sentinel forces "unconfigured" unconditionally: `setStorageBackendForTesting(null)` would instead
        // fall through to the real `serverEnv`, which could make a real R2 call if a contributor's local
        // .env.local happens to have R2 configured (AGENTS.md §6.11 forbids that in a test).
        setStorageBackendForTesting(STORAGE_UNCONFIGURED_FOR_TESTING)
        const response = await manager.post(uploadProductImage, `products/${product.id}/image`, {
            params: { id: product.id },
            formData: formWith(jpegFile())
        })
        expect(response.status).toBe(503)
        expect(errorOf(response).code).toBe('storage_not_configured')
    })
})

describe('store logo upload', () => {
    test('an admin uploads and removes the logo; a manager is forbidden', async () => {
        expect((await manager.post(uploadLogo, 'settings/logo', { formData: formWith(jpegFile()) })).status).toBe(403)

        const uploaded = await admin.post(uploadLogo, 'settings/logo', { formData: formWith(jpegFile()) })
        expect(uploaded.status).toBe(200)
        const { store_logo_url } = dataOf<{ store_logo_url: string }>(uploaded)
        expect(store_logo_url).toContain('/settings/logo/')
        expect(storage.objects.size).toBe(1)

        const removed = await admin.delete(deleteLogo, 'settings/logo')
        expect(removed.status).toBe(200)
        expect(dataOf<{ store_logo_url: null }>(removed).store_logo_url).toBeNull()
        expect(storage.objects.size).toBe(0)
    })

    test('replacing the logo deletes the previous object', async () => {
        await admin.post(uploadLogo, 'settings/logo', { formData: formWith(jpegFile()) })
        expect(storage.objects.size).toBe(1)
        const keysAfterFirst = [...storage.objects.keys()]

        await admin.post(uploadLogo, 'settings/logo', { formData: formWith(jpegFile('new-logo.jpg')) })
        expect(storage.objects.size).toBe(1)
        expect([...storage.objects.keys()]).not.toEqual(keysAfterFirst)

        await admin.delete(deleteLogo, 'settings/logo')
    })

    test('without the 4 R2 env vars, the logo endpoint also answers 503', async () => {
        setStorageBackendForTesting(STORAGE_UNCONFIGURED_FOR_TESTING)
        const response = await admin.post(uploadLogo, 'settings/logo', { formData: formWith(jpegFile()) })
        expect(response.status).toBe(503)
        expect(errorOf(response).code).toBe('storage_not_configured')
    })
})
