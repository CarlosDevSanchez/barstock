import { payloadTooLarge, unsupportedMediaType } from '@/lib/server/errors'
import { ok, readUploadedFile, route } from '@/lib/server/http'
import { getProduct, setProductImage } from '@/lib/server/services/products'
import {
    assertStorageConfigured,
    deleteObject,
    productImageKey,
    putObject,
    signedGetUrl,
    validateImage
} from '@/lib/server/storage'
import { idParamsSchema } from '@/lib/validation/common'

/**
 * Uploads a product's image: the server validates real magic bytes and the size cap (never trusting the browser's
 * Content-Type), so R2 never needs CORS or public write access. Order matters: getProduct first (RLS + 404), then
 * upload, then the DB update, then delete the previous object — never the other way, so a failure never leaves the
 * product pointing at a missing object.
 */
export const POST = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ request, params, supabase }) => {
        assertStorageConfigured()
        const product = await getProduct(supabase, params.id)

        const bytes = await readUploadedFile(request)
        const validation = validateImage(bytes)
        if (!validation.ok) throw validation.reason === 'too_large' ? payloadTooLarge() : unsupportedMediaType()

        const key = productImageKey(product.id, validation.extension)
        await putObject(key, bytes, validation.contentType)

        try {
            await setProductImage(supabase, product.id, key)
        } catch (error) {
            // The DB write failed after the upload succeeded: delete the orphan instead of leaking it.
            await deleteObject(key).catch(cleanupError =>
                console.error('[storage] orphan cleanup failed', key, cleanupError)
            )
            throw error
        }

        if (product.image_key) {
            await deleteObject(product.image_key).catch(cleanupError =>
                console.error('[storage] failed to delete previous product image', product.image_key, cleanupError)
            )
        }

        return ok({ image_url: await signedGetUrl(key) })
    }
})

export const DELETE = route({
    role: 'manager',
    params: idParamsSchema,
    handler: async ({ params, supabase }) => {
        assertStorageConfigured()
        const product = await getProduct(supabase, params.id)
        if (product.image_key) {
            await setProductImage(supabase, product.id, null)
            await deleteObject(product.image_key).catch(cleanupError =>
                console.error('[storage] failed to delete product image', product.image_key, cleanupError)
            )
        }
        return ok({ image_url: null })
    }
})
