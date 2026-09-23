import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import { pageRange } from '@/lib/validation/common'
import type {
    AddTabItemsInput,
    AddTabMembersInput,
    OpenTabInput,
    PayTabInput,
    RemoveTabItemInput,
    SetTabDiscountInput,
    TabsQuery,
    VoidTabInput
} from '@/lib/validation/tabs'
import type { Tables } from '@/types/database'
import { assertMoneyScale, type Page } from './_shared'

export type TabListItem = Tables<'tabs'> & { customer: Pick<Tables<'customers'>, 'id' | 'name'> | null }

export interface TabTotals {
    subtotal: number
    tax: number
    discount: number
    total: number
    paid: number
    balance: number
}

export type TabDetail = Tables<'tabs'> & {
    customer: Pick<Tables<'customers'>, 'id' | 'name' | 'phone'> | null
    members: Tables<'tab_members'>[]
    items: Array<
        Tables<'tab_items'> & {
            product: Pick<Tables<'products'>, 'id' | 'name' | 'sku'>
            variant: Pick<Tables<'product_variants'>, 'id' | 'name'> | null
            promotion:
                | (Pick<Tables<'promotions'>, 'id' | 'name'> & {
                      items: Array<Pick<Tables<'promotion_items'>, 'product_id' | 'quantity'>>
                  })
                | null
        }
    >
    payments: Tables<'tab_payments'>[]
    totals: TabTotals
}

const DETAIL_SELECT =
    '*, customer:customers(id, name, phone), members:tab_members(*), items:tab_items(*, product:products(id, name, sku), variant:product_variants(id, name), promotion:promotions(id, name, items:promotion_items(product_id, quantity))), payments:tab_payments(*)'

export async function listTabs(
    supabase: AppSupabaseClient,
    { page, pageSize, status }: TabsQuery
): Promise<Page<TabListItem>> {
    let query = supabase
        .from('tabs')
        .select('*, customer:customers(id, name)', { count: 'exact' })
        .order('opened_at', { ascending: false })
    if (status) query = query.eq('status', status)

    const { from, to } = pageRange({ page, pageSize })
    const { data, count, error } = await query.range(from, to)
    assertNoError(error)
    return { rows: data, total: count ?? 0 }
}

export async function getTab(supabase: AppSupabaseClient, id: string): Promise<TabDetail> {
    const { data, error } = await supabase.from('tabs').select(DETAIL_SELECT).eq('id', id).maybeSingle()
    assertNoError(error)
    if (!data) throw notFound('Tab not found')

    const { data: totalsRows, error: totalsError } = await supabase.rpc('tab_summary', { p_tab_id: id })
    assertNoError(totalsError)
    const totals = totalsRows[0]
    if (!totals) throw notFound('Tab not found')

    return { ...data, totals }
}

export async function openTab(supabase: AppSupabaseClient, input: OpenTabInput): Promise<TabDetail> {
    const { data: tabId, error } = await supabase.rpc('open_tab', {
        p_label: input.label,
        // The generated type says `string`, but the function accepts NULL (no linked customer).
        p_customer_id: (input.customer_id ?? null) as string,
        p_members: input.members ?? []
    })
    assertNoError(error)
    return getTab(supabase, tabId)
}

export async function addTabMembers(
    supabase: AppSupabaseClient,
    id: string,
    input: AddTabMembersInput
): Promise<TabDetail> {
    const { error } = await supabase.rpc('tab_add_members', { p_tab_id: id, p_names: input.names })
    assertNoError(error)
    return getTab(supabase, id)
}

export async function addTabItems(
    supabase: AppSupabaseClient,
    id: string,
    input: AddTabItemsInput
): Promise<TabDetail> {
    const { error } = await supabase.rpc('tab_add_items', {
        p_tab_id: id,
        p_items: input.items.map(item =>
            'promotion_id' in item
                ? { promotion_id: item.promotion_id, quantity: item.quantity }
                : {
                      product_id: item.product_id,
                      variant_id: item.variant_id ?? null,
                      quantity: item.quantity,
                      ...(item.discount !== undefined ? { discount: item.discount } : {})
                  }
        )
    })
    assertNoError(error)
    return getTab(supabase, id)
}

export async function removeTabItem(
    supabase: AppSupabaseClient,
    id: string,
    itemId: string,
    input: RemoveTabItemInput
): Promise<TabDetail> {
    const { error } = await supabase.rpc('tab_remove_item', {
        p_tab_id: id,
        p_item_id: itemId,
        p_quantity: input.quantity,
        p_reason: input.reason
    })
    assertNoError(error)
    return getTab(supabase, id)
}

export async function setTabDiscount(
    supabase: AppSupabaseClient,
    id: string,
    input: SetTabDiscountInput
): Promise<TabDetail> {
    await assertMoneyScale(supabase, { discount: input.discount })
    const { error } = await supabase.rpc('tab_set_discount', { p_tab_id: id, p_discount: input.discount })
    assertNoError(error)
    return getTab(supabase, id)
}

export async function payTab(supabase: AppSupabaseClient, id: string, input: PayTabInput): Promise<TabDetail> {
    await assertMoneyScale(supabase, { amount: input.amount })
    const { error } = await supabase.rpc('tab_pay', {
        p_tab_id: id,
        p_member_id: (input.member_id ?? null) as string,
        p_method: input.payment_method,
        p_amount: input.amount
    })
    assertNoError(error)
    return getTab(supabase, id)
}

export async function voidTab(supabase: AppSupabaseClient, id: string, input: VoidTabInput): Promise<TabDetail> {
    const { error } = await supabase.rpc('void_tab', { p_tab_id: id, p_reason: input.reason })
    assertNoError(error)
    return getTab(supabase, id)
}
