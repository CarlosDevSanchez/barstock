import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import type { SaleInput } from '@/lib/validation/resources'
import { assertMoneyScale } from './_shared'
import { getOrder, type OrderDetail } from './orders'

/**
 * Rings up a sale through the `create_sale` RPC: one transaction that reads prices and taxes from the database,
 * decrements stock and records order, items, payment and stock movements. The client's totals are never used.
 */
export async function createSale(supabase: AppSupabaseClient, input: SaleInput): Promise<OrderDetail> {
    await assertMoneyScale(supabase, {
        discount: input.discount,
        ...Object.fromEntries(input.items.map((item, index) => [`items.${index}.discount`, item.discount]))
    })
    const { data: orderId, error } = await supabase.rpc('create_sale', {
        // The generated type says `string`, but the function accepts NULL (walk-in customer).
        p_customer_id: (input.customer_id ?? null) as string,
        p_items: input.items.map(item => ({
            product_id: item.product_id,
            variant_id: item.variant_id ?? null,
            quantity: item.quantity,
            discount: item.discount ?? 0
        })),
        p_payment_method: input.payment_method,
        p_discount: input.discount ?? 0
    })
    assertNoError(error)
    return getOrder(supabase, orderId)
}
