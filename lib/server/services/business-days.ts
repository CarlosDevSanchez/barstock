import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import type { AdjustBusinessDayInput } from '@/lib/validation/cash'
import type { Tables } from '@/types/database'

export type BusinessDay = Tables<'business_days'>

async function readDay(supabase: AppSupabaseClient, id: string): Promise<BusinessDay> {
    const { data, error } = await supabase.from('business_days').select('*').eq('id', id).maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Business day not found')
    return data
}

export async function listBusinessDays(
    supabase: AppSupabaseClient,
    needsReview: boolean | undefined
): Promise<BusinessDay[]> {
    let query = supabase.from('business_days').select('*').order('opened_at', { ascending: false }).limit(50)
    if (needsReview !== undefined) query = query.eq('needs_review', needsReview)
    const { data, error } = await query
    assertNoError(error)
    return data ?? []
}

export async function openBusinessDay(supabase: AppSupabaseClient, notes: string | null): Promise<BusinessDay> {
    const { data, error } = await supabase.rpc('open_business_day', { p_notes: notes ?? undefined })
    assertNoError(error)
    if (!data) throw notFound('Business day not found')
    return readDay(supabase, data)
}

export async function closeBusinessDay(
    supabase: AppSupabaseClient,
    id: string,
    notes: string | null
): Promise<BusinessDay> {
    const { error } = await supabase.rpc('close_business_day', { p_id: id, p_notes: notes ?? undefined })
    assertNoError(error)
    return readDay(supabase, id)
}

export async function adjustBusinessDay(
    supabase: AppSupabaseClient,
    id: string,
    input: AdjustBusinessDayInput
): Promise<BusinessDay> {
    const { error } = await supabase.rpc('adjust_business_day', {
        p_id: id,
        p_opened_at: new Date(input.opened_at).toISOString(),
        p_closed_at: input.closed_at ? new Date(input.closed_at).toISOString() : (null as unknown as string),
        p_notes: input.notes ?? undefined
    })
    assertNoError(error)
    return readDay(supabase, id)
}
