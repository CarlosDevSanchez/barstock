import { afterEach, describe, expect, test } from 'bun:test'
import {
    InMemoryStorage,
    isStorageConfigured,
    logoImageKey,
    MAX_IMAGE_BYTES,
    presignDatetime,
    productImageKey,
    setStorageBackendForTesting,
    SIGNED_URL_TTL_SECONDS,
    signedGetUrl,
    STORAGE_UNCONFIGURED_FOR_TESTING,
    validateImage
} from './storage'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

describe('validateImage', () => {
    test('accepts real JPEG/PNG/WebP magic bytes', () => {
        expect(validateImage(JPEG)).toEqual({ ok: true, extension: 'jpg', contentType: 'image/jpeg' })
        expect(validateImage(PNG)).toEqual({ ok: true, extension: 'png', contentType: 'image/png' })
        expect(validateImage(WEBP)).toEqual({ ok: true, extension: 'webp', contentType: 'image/webp' })
    })

    test('rejects bytes that are not a real image, even with an image-like name (checked by the caller, not here)', () => {
        expect(validateImage(new TextEncoder().encode('not an image'))).toEqual({ ok: false, reason: 'invalid_type' })
        expect(validateImage(new Uint8Array())).toEqual({ ok: false, reason: 'invalid_type' })
    })

    test('rejects a PDF (another common disguise for a fake image upload)', () => {
        const pdf = new TextEncoder().encode('%PDF-1.4\n...')
        expect(validateImage(pdf)).toEqual({ ok: false, reason: 'invalid_type' })
    })

    test('rejects anything over the 2 MB cap, even with valid magic bytes', () => {
        const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
        big.set(JPEG)
        expect(validateImage(big)).toEqual({ ok: false, reason: 'too_large' })
    })

    test('accepts exactly the 2 MB cap', () => {
        const exact = new Uint8Array(MAX_IMAGE_BYTES)
        exact.set(JPEG)
        expect(validateImage(exact)).toEqual({ ok: true, extension: 'jpg', contentType: 'image/jpeg' })
    })
})

describe('key generation', () => {
    test('product keys match the CHECK constraint on products.image_key (migration 20260923000003)', () => {
        const productId = crypto.randomUUID()
        for (const extension of ['webp', 'jpg', 'png'] as const) {
            const key = productImageKey(productId, extension)
            expect(key).toMatch(new RegExp(`^products/${productId}/${UUID_RE}\\.${extension}$`))
            expect(key).toMatch(/^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/)
        }
    })

    test('two uploads for the same product never collide', () => {
        const productId = crypto.randomUUID()
        expect(productImageKey(productId, 'png')).not.toBe(productImageKey(productId, 'png'))
    })

    test('logo keys live under settings/logo/ and are never chosen by a caller-supplied id', () => {
        const key = logoImageKey('jpg')
        expect(key).toMatch(new RegExp(`^settings/logo/${UUID_RE}\\.jpg$`))
    })
})

describe('test seam (setStorageBackendForTesting)', () => {
    afterEach(() => setStorageBackendForTesting(null))

    test('an injected backend is reported as configured', () => {
        setStorageBackendForTesting(new InMemoryStorage())
        expect(isStorageConfigured()).toBe(true)
    })

    test('STORAGE_UNCONFIGURED_FOR_TESTING forces "unconfigured" even over a backend set moments earlier', () => {
        setStorageBackendForTesting(new InMemoryStorage())
        expect(isStorageConfigured()).toBe(true)

        setStorageBackendForTesting(STORAGE_UNCONFIGURED_FOR_TESTING)
        expect(isStorageConfigured()).toBe(false)
    })
})

describe('signed URL lifetime and stability', () => {
    afterEach(() => setStorageBackendForTesting(null))

    test('defaults to a 12 h TTL, long enough for a POS left open all shift', async () => {
        expect(SIGNED_URL_TTL_SECONDS).toBe(12 * 60 * 60)
        setStorageBackendForTesting(new InMemoryStorage())
        expect(await signedGetUrl('products/a/b.webp')).toContain('X-Amz-Expires=43200')
    })

    test('the signing time is floored to the hour, so reads within the same hour get the same (cacheable) URL', () => {
        expect(presignDatetime(new Date('2026-09-22T14:00:00.000Z'))).toBe('20260922T140000Z')
        expect(presignDatetime(new Date('2026-09-22T14:59:59.999Z'))).toBe('20260922T140000Z')
        expect(presignDatetime(new Date('2026-09-22T15:00:00.000Z'))).toBe('20260922T150000Z')
    })
})
