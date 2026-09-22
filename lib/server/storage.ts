import 'server-only'
import { AwsClient } from 'aws4fetch'
import { serverEnv } from '@/lib/env/server'
import { storageNotConfigured } from './errors'

/**
 * The single seam between the app and Cloudflare R2. Nothing outside this file should construct an S3 request or
 * import `aws4fetch`. Object keys are always generated here (`productImageKey` / `logoImageKey`): the client never
 * sees or chooses one (see app/api/v1/products/[id]/image/route.ts and app/api/v1/settings/logo/route.ts).
 */
export interface StorageBackend {
    putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>
    deleteObject(key: string): Promise<void>
    /** Presigned GET (query-string signing): pure HMAC, no network call. */
    signedGetUrl(key: string, ttlSeconds: number): Promise<string>
}

// ---- Test seam -----------------------------------------------------------------------------------------------
// Integration tests inject `InMemoryStorage` here so they never touch a real bucket or the network (AGENTS.md
// §6.11: writes only against local infra). Production code never calls this.

let backendOverride: StorageBackend | null = null

/** Test-only: substitutes the storage backend. Call with `null` (e.g. in `afterAll`) to restore normal behaviour. */
export function setStorageBackendForTesting(backend: StorageBackend | null): void {
    backendOverride = backend
}

/** In-memory `StorageBackend`: no network, no real signing, just a Map. For integration tests only. */
export class InMemoryStorage implements StorageBackend {
    readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>()

    async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
        this.objects.set(key, { bytes, contentType })
    }

    async deleteObject(key: string): Promise<void> {
        this.objects.delete(key)
    }

    async signedGetUrl(key: string, ttlSeconds: number): Promise<string> {
        return `https://test-storage.local/${key}?X-Amz-Expires=${ttlSeconds}`
    }
}

// ---- Key generation (server-owned) ----------------------------------------------------------------------------

export type ImageExtension = 'webp' | 'jpg' | 'png'

/** `products/{productId}/{uuid}.ext` — matches the CHECK constraint on `products.image_key` (migration 20260923000003). */
export function productImageKey(productId: string, extension: ImageExtension): string {
    return `products/${productId}/${crypto.randomUUID()}.${extension}`
}

/** `settings/logo/{uuid}.ext` — the store logo (settings.store_logo_key, reserved in Phase 5). */
export function logoImageKey(extension: ImageExtension): string {
    return `settings/logo/${crypto.randomUUID()}.${extension}`
}

// ---- Validation (real magic bytes, never the filename or the client's Content-Type) ----------------------------

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB

export type ImageValidation =
    { ok: true; extension: ImageExtension; contentType: string } | { ok: false; reason: 'too_large' | 'invalid_type' }

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
    bytes.byteLength >= prefix.length && prefix.every((byte, index) => bytes[index] === byte)

const isWebp = (bytes: Uint8Array): boolean =>
    bytes.byteLength >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"

/** Checks real magic bytes (JPEG/PNG/WebP) and the 2 MB cap. Has no side effects and needs no env/storage config. */
export function validateImage(bytes: Uint8Array): ImageValidation {
    if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' }
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ok: true, extension: 'jpg', contentType: 'image/jpeg' }
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return { ok: true, extension: 'png', contentType: 'image/png' }
    }
    if (isWebp(bytes)) return { ok: true, extension: 'webp', contentType: 'image/webp' }
    return { ok: false, reason: 'invalid_type' }
}

// ---- R2 backend (Cloudflare's S3-compatible API, signed with aws4fetch) ----------------------------------------

class R2Storage implements StorageBackend {
    private readonly client: AwsClient
    private readonly base: string

    constructor(accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string) {
        this.client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' })
        this.base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`
    }

    async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
        // Blob (not the raw Uint8Array) sidesteps a BodyInit typing mismatch between TS's generic
        // Uint8Array<ArrayBufferLike> and lib.dom's BufferSource in this TS/lib combination.
        const response = await this.client.fetch(`${this.base}/${key}`, {
            method: 'PUT',
            body: new Blob([new Uint8Array(bytes)], { type: contentType }),
            headers: { 'content-type': contentType }
        })
        if (!response.ok) throw new Error(`R2 put failed (${response.status}): ${key}`)
    }

    async deleteObject(key: string): Promise<void> {
        const response = await this.client.fetch(`${this.base}/${key}`, { method: 'DELETE' })
        if (!response.ok && response.status !== 404) throw new Error(`R2 delete failed (${response.status}): ${key}`)
    }

    async signedGetUrl(key: string, ttlSeconds: number): Promise<string> {
        const url = new URL(`${this.base}/${key}`)
        url.searchParams.set('X-Amz-Expires', String(ttlSeconds))
        // `sign()` only computes the HMAC signature over the request: it never touches the network.
        const signed = await this.client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } })
        return signed.url
    }
}

let r2: R2Storage | null = null

/** `null` when the 4 R2 vars are not all set (lib/env/schema.ts guarantees it is never a partial set). */
function resolveBackend(): StorageBackend | null {
    if (backendOverride) return backendOverride
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = serverEnv
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null
    r2 ??= new R2Storage(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)
    return r2
}

export function isStorageConfigured(): boolean {
    return resolveBackend() !== null
}

/** Route handlers call this first, before reading the request body, so an unconfigured bucket fails fast. */
export function assertStorageConfigured(): void {
    if (!isStorageConfigured()) throw storageNotConfigured()
}

function backend(): StorageBackend {
    const resolved = resolveBackend()
    if (!resolved) throw storageNotConfigured()
    return resolved
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await backend().putObject(key, bytes, contentType)
}

export async function deleteObject(key: string): Promise<void> {
    await backend().deleteObject(key)
}

export async function signedGetUrl(key: string, ttlSeconds = 3600): Promise<string> {
    return backend().signedGetUrl(key, ttlSeconds)
}

/**
 * Null-safe convenience for read services (`listProducts`, `getProduct`, `getSettings`): no key, or storage not
 * configured, just means no image yet — never an error the caller has to handle.
 */
export async function trySignedGetUrl(key: string | null | undefined, ttlSeconds = 3600): Promise<string | null> {
    if (!key || !isStorageConfigured()) return null
    return signedGetUrl(key, ttlSeconds)
}
