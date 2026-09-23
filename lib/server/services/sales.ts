import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import type { SaleInput } from '@/lib/validation/resources'
import { assertMoneyScale } from './_shared'
import { getOrder, type OrderDetail } from './orders'

/**
 * Rings up a sale through the `create_sale` RPC: one transaction that reads prices and taxes from the database,
 * decrements stock and records order, items, payment and stock movements. The client's totals are never used.
 *
 * `idempotencyKey` protects against a lost response causing a second charge (a retry, or the cashier pressing
 * "Cobrar" again before the first request returns): the RPC returns the same order on a replay of the same key
 * with the same payload instead of ringing up the sale twice.
 */
export async function createSale(
    supabase: AppSupabaseClient,
    input: SaleInput,
    idempotencyKey?: string | null
): Promise<OrderDetail> {
    const discountFields: Record<string, number | undefined> = { discount: input.discount }
    for (const [index, item] of input.items.entries()) {
        if ('product_id' in item) discountFields[`items.${index}.discount`] = item.discount
    }
    await assertMoneyScale(supabase, discountFields)
    const { data: orderId, error } = await supabase.rpc('create_sale', {
        // The generated type says `string`, but the function accepts NULL (walk-in customer).
        p_customer_id: (input.customer_id ?? null) as string,
        p_items: input.items.map(item =>
            'promotion_id' in item
                ? { promotion_id: item.promotion_id, quantity: item.quantity }
                : {
                      product_id: item.product_id,
                      variant_id: item.variant_id ?? null,
                      quantity: item.quantity,
                      discount: item.discount ?? 0
                  }
        ),
        p_payment_method: input.payment_method,
        p_discount: input.discount ?? 0,
        p_idempotency_key: (idempotencyKey ?? null) as string
    })
    assertNoError(error)
    return getOrder(supabase, orderId)
}
