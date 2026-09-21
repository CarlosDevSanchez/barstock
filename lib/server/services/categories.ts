import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange, type Pagination } from '@/lib/validation/common'
import type { CategoryCreate, CategoryUpdate } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { searchFilter, type Page } from './_shared'

export type CategoryListItem = Tables<'categories'> & { product_count: number }

export async function listCategories(
    supabase: AppSupabaseClient,
    { page, pageSize, q }: Pagination
): Promise<Page<CategoryListItem>> {
    let query = supabase.from('categories').select('*, products(count)', { count: 'exact' }).order('name')
    const filter = searchFilter(q, ['name'])
    if (filter) query = query.or(filter)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)

    return {
        rows: data.map(({ products, ...category }) => ({ ...category, product_count: products[0]?.count ?? 0 })),
        total: count ?? 0
    }
}

export async function createCategory(
    supabase: AppSupabaseClient,
    input: CategoryCreate
): Promise<Tables<'categories'>> {
    const { data, error } = await supabase.from('categories').insert(input).select().single()
    assertNoError(error)
    return data
}

export async function updateCategory(
    supabase: AppSupabaseClient,
    id: string,
    patch: CategoryUpdate
): Promise<Tables<'categories'>> {
    const { data, error } = await supabase.from('categories').update(patch).eq('id', id).select().maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Category not found')
    return data
}

/** Hard delete: the foreign keys reject a category still used by products (409). */
export async function deleteCategory(supabase: AppSupabaseClient, id: string): Promise<void> {
    const { data, error } = await supabase.from('categories').delete().eq('id', id).select('id').maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Category not found')
}
