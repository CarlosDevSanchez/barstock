import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange, type Pagination } from '@/lib/validation/common'
import type { CustomerCreate, CustomerUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { searchFilter, type Page } from './_shared'

export async function listCustomers(
    supabase: AppSupabaseClient,
    { page, pageSize, q }: Pagination
): Promise<Page<Tables<'customers'>>> {
    let query = supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
    const filter = searchFilter(q, ['name', 'email', 'phone'])
    if (filter) query = query.or(filter)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)
    return { rows: data, total: count ?? 0 }
}

export async function getCustomer(supabase: AppSupabaseClient, id: string): Promise<Tables<'customers'>> {
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Customer not found')
    return data
}

export async function createCustomer(supabase: AppSupabaseClient, input: CustomerCreate): Promise<Tables<'customers'>> {
    const { data, error } = await supabase.from('customers').insert(input).select().single()
    assertNoError(error)
    return data
}

export async function updateCustomer(
    supabase: AppSupabaseClient,
    id: string,
    patch: CustomerUpdate
): Promise<Tables<'customers'>> {
    const { data, error } = await supabase
        .from('customers')
        .update(patch)
        .eq('id', id)
        .is('deleted_at', null)
        .select()
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Customer not found')
    return data
}

/** Soft delete: order history keeps pointing at the customer. Admin only (RLS trigger guard_soft_delete). */
export async function deleteCustomer(supabase: AppSupabaseClient, id: string): Promise<void> {
    const { data, error } = await supabase
        .from('customers')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Customer not found')
}
