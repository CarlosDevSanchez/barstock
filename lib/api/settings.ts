import type { SettingsInput } from '@/lib/validation/resources'
import { apiGet, apiPatch } from './client'

export const settingsApi = {
    get: (signal?: AbortSignal) => apiGet<SettingsInput>('settings', undefined, signal),
    update: (patch: Partial<SettingsInput>) => apiPatch<SettingsInput>('settings', patch)
}
