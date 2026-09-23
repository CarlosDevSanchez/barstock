import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import type { OrdersQuery } from '@/lib/validation/resources'
import type { Tables } from '@/types/database'
import { searchFilter, type Page } from './_shared'

export type OrderListItem = Tables<'orders'> & { customer: Pick<Tables<'customers'>, 'id' | 'name'> | null }

export type OrderDetail = Tables<'orders'> & {
    customer: Pick<Tables<'customers'>, 'id' | 'name' | 'email' | 'phone'> | null
    items: Array<
        Tables<'order_items'> & {
            product: Pick<Tables<'products'>, 'id' | 'name' | 'sku'>
            variant: Pick<Tables<'product_variants'>, 'id' | 'name'> | null
            promotion: Pick<Tables<'promotions'>, 'id' | 'name'> | null
        }
    >
    payments: Tables<'payments'>[]
    /** Who rang up the sale (null when the caller may not read that profile). */
    created_by_name: string | null
    /** Set when this order came from a closed tab (an account with several people/payments); null for a direct sale. */
    tab: Pick<Tables<'tabs'>, 'id' | 'tab_number' | 'label'> | null
}

// One literal on purpose: supabase-js infers the result type from the select string, and `+` would widen it to `string`.
// `!orders_tab_id_fkey` disambiguates: orders.tab_id -> tabs.id AND tabs.order_id -> orders.id are two different FKs
// between the same two tables, so PostgREST cannot pick one on its own.
const DETAIL_SELECT =
    '*, customer:customers(id, name, email, phone), items:order_items(*, product:products(id, name, sku), variant:product_variants(id, name), promotion:promotions(id, name)), payments(*), tab:tabs!orders_tab_id_fkey(id, tab_number, label)'

/** Cashiers only see their own orders, managers and admins all of them: RLS decides, not this code. */
export async function listOrders(
    supabase: AppSupabaseClient,
    { page, pageSize, q, status, customer_id, from: dateFrom, to: dateTo }: OrdersQuery
): Promise<Page<OrderListItem>> {
    let query = supabase
        .from('orders')
        .select('*, customer:customers(id, name)', { count: 'exact' })
        .order('created_at', { ascending: false })
    const filter = searchFilter(q, ['order_number'])
    if (filter) query = query.or(filter)
    if (status) query = query.eq('status', status)
    if (customer_id) query = query.eq('customer_id', customer_id)
    if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00Z`)
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)
    return { rows: data, total: count ?? 0 }
}

export async function getOrder(supabase: AppSupabaseClient, id: string): Promise<OrderDetail> {
    const { data, error } = await supabase.from('orders').select(DETAIL_SELECT).eq('id', id).maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Order not found')

    // orders.created_by references auth.users, not profiles, so PostgREST cannot embed the profile: look it up.
    let createdByName: string | null = null
    if (data.created_by) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', data.created_by)
            .maybeSingle()
        createdByName = profile?.full_name ?? profile?.email ?? null
    }
    return { ...data, created_by_name: createdByName }
}

export async function refundOrder(supabase: AppSupabaseClient, id: string, reason: string): Promise<OrderDetail> {
    const { error } = await supabase.rpc('refund_order', { p_order_id: id, p_reason: reason })
    assertNoError(error)
    return getOrder(supabase, id)
}
