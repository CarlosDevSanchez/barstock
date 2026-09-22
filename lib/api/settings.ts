import type { SettingsWithLogoUrl } from '@/lib/server/services/settings'
import type { SettingsInput } from '@/lib/validation/resources'
import { apiDelete, apiGet, apiPatch, apiPostForm } from './client'

export type { SettingsWithLogoUrl }

export const settingsApi = {
    get: (signal?: AbortSignal) => apiGet<SettingsWithLogoUrl>('settings', undefined, signal),
    update: (patch: Partial<SettingsInput>) => apiPatch<SettingsWithLogoUrl>('settings', patch),
    uploadLogo: (file: File) => {
        const formData = new FormData()
        formData.append('file', file)
        return apiPostForm<{ store_logo_url: string }>('settings/logo', formData)
    },
    removeLogo: () => apiDelete<{ store_logo_url: null }>('settings/logo')
}
