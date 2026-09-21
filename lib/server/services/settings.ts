import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { settingsSchema, type SettingKey, type SettingsInput } from '@/lib/validation/resources'
import type { Json } from '@/types/database'

// Used when a key is missing or holds an invalid value, so the UI never has to handle a partial object.
export const SETTINGS_DEFAULTS: SettingsInput = {
    store_name: 'My Store',
    store_address: '',
    store_phone: '',
    store_email: '',
    currency: 'USD',
    timezone: 'UTC',
    low_stock_threshold: 10,
    tax_rate: 0.1,
    receipt_template: { header: 'Thank you for your purchase!', footer: 'Visit us again!' }
}

const KEYS = Object.keys(settingsSchema.shape) as SettingKey[]

export async function getSettings(supabase: AppSupabaseClient): Promise<SettingsInput> {
    const { data, error } = await supabase.from('settings').select('key, value')
    assertNoError(error)

    const stored = new Map(data.map(row => [row.key, row.value]))
    const result = { ...SETTINGS_DEFAULTS }
    for (const key of KEYS) {
        const parsed = settingsSchema.shape[key].safeParse(stored.get(key))
        if (parsed.success) Object.assign(result, { [key]: parsed.data })
    }
    return result
}

/** Admin only (RLS and the route). Each key is one JSONB row in `settings`. */
export async function updateSettings(
    supabase: AppSupabaseClient,
    patch: Partial<SettingsInput>
): Promise<SettingsInput> {
    const rows = Object.entries(patch)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({ key, value: value as Json }))
    if (rows.length > 0) {
        const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' })
        assertNoError(error)
    }
    return getSettings(supabase)
}
