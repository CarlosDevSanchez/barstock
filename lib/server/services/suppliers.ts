import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange, type Pagination } from '@/lib/validation/common'
import type { SupplierCreate, SupplierUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { searchFilter, type Page } from './_shared'

export async function listSuppliers(
    supabase: AppSupabaseClient,
    { page, pageSize, q }: Pagination
): Promise<Page<Tables<'suppliers'>>> {
    let query = supabase
        .from('suppliers')
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
    const filter = searchFilter(q, ['name', 'contact_person', 'email'])
    if (filter) query = query.or(filter)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)
    return { rows: data, total: count ?? 0 }
}

export async function getSupplier(supabase: AppSupabaseClient, id: string): Promise<Tables<'suppliers'>> {
    const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Supplier not found')
    return data
}

export async function createSupplier(supabase: AppSupabaseClient, input: SupplierCreate): Promise<Tables<'suppliers'>> {
    const { data, error } = await supabase.from('suppliers').insert(input).select().single()
    assertNoError(error)
    return data
}

export async function updateSupplier(
    supabase: AppSupabaseClient,
    id: string,
    patch: SupplierUpdate
): Promise<Tables<'suppliers'>> {
    const { data, error } = await supabase
        .from('suppliers')
        .update(patch)
        .eq('id', id)
        .is('deleted_at', null)
        .select()
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Supplier not found')
    return data
}

/** Soft delete: purchase history keeps pointing at the supplier. Admin only (RLS trigger guard_soft_delete). */
export async function deleteSupplier(supabase: AppSupabaseClient, id: string): Promise<void> {
    const { data, error } = await supabase
        .from('suppliers')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Supplier not found')
}
