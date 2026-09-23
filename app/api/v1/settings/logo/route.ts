import { payloadTooLarge, unsupportedMediaType } from '@/lib/server/errors'
import { ok, readUploadedFile, route } from '@/lib/server/http'
import { getSettings, updateSettings } from '@/lib/server/services/settings'
import {
    assertStorageConfigured,
    deleteObject,
    logoImageKey,
    putObject,
    signedGetUrl,
    validateImage
} from '@/lib/server/storage'

/** Uploads the receipt/sidebar logo. Same shape as the product image endpoint, admin-only (settings are admin-only). */
export const POST = route({
    role: 'admin',
    handler: async ({ request, supabase }) => {
        assertStorageConfigured()
        const bytes = await readUploadedFile(request)
        const validation = validateImage(bytes)
        if (!validation.ok) throw validation.reason === 'too_large' ? payloadTooLarge() : unsupportedMediaType()

        const previous = await getSettings(supabase)
        const key = logoImageKey(validation.extension)
        await putObject(key, bytes, validation.contentType)

        try {
            await updateSettings(supabase, { store_logo_key: key })
        } catch (error) {
            await deleteObject(key).catch(cleanupError =>
                console.error('[storage] orphan cleanup failed', key, cleanupError)
            )
            throw error
        }

        if (previous.store_logo_key) {
            await deleteObject(previous.store_logo_key).catch(cleanupError =>
                console.error('[storage] failed to delete previous logo', previous.store_logo_key, cleanupError)
            )
        }

        return ok({ store_logo_url: await signedGetUrl(key) })
    }
})

export const DELETE = route({
    role: 'admin',
    handler: async ({ supabase }) => {
        assertStorageConfigured()
        const current = await getSettings(supabase)
        if (current.store_logo_key) {
            await updateSettings(supabase, { store_logo_key: '' })
            await deleteObject(current.store_logo_key).catch(cleanupError =>
                console.error('[storage] failed to delete logo', current.store_logo_key, cleanupError)
            )
        }
        return ok({ store_logo_url: null })
    }
})
