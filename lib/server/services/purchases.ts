import 'server-only'
import { assertNoError, notFound } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import type { PurchaseReceive, PurchaseVoid, SupplierHistoryQuery } from '@/lib/validation/purchases'
import { assertMoneyScale } from './_shared'

/** Call an RPC that is not yet in the generated Database types. */
async function callRpc(
    supabase: AppSupabaseClient,
    fn: string,
    args: Record<string, unknown>
): Promise<{ data: unknown; error: Parameters<typeof assertNoError>[0] }> {
    // ponytail: cast until `bun run db:types` regenerates Functions after this migration.
    const result = await (
        supabase as unknown as {
            rpc: (
                name: string,
                params: Record<string, unknown>
            ) => PromiseLike<{ data: unknown; error: Parameters<typeof assertNoError>[0] }>
        }
    ).rpc(fn, args)
    return { data: result.data, error: result.error }
}

export interface SupplierPurchaseHistory {
    purchases: {
        id: string
        po_number: string
        invoice_number: string | null
        received_at: string
        total_amount: number
    }[]
    total: number
    products: {
        product_id: string
        name: string
        quantity: number
        last_unit_cost: number
        average_unit_cost: number
    }[]
}

export async function receivePurchase(
    supabase: AppSupabaseClient,
    input: PurchaseReceive,
    idempotencyKey: string
): Promise<{ id: string }> {
    const costs: Record<string, number> = {}
    for (const [index, item] of input.items.entries()) {
        costs[`items.${index}.unit_cost`] = item.unit_cost
    }
    await assertMoneyScale(supabase, costs)

    const { data, error } = await callRpc(supabase, 'receive_purchase', {
        p_supplier_id: input.supplier_id,
        p_items: input.items,
        p_invoice: input.invoice_number ?? null,
        p_notes: input.notes ?? null,
        p_cash_session_id: input.cash_session_id ?? null,
        p_idempotency_key: idempotencyKey
    })
    assertNoError(error)
    if (typeof data !== 'string') throw notFound('Purchase not found')
    return { id: data }
}

export async function voidPurchase(supabase: AppSupabaseClient, id: string, input: PurchaseVoid): Promise<void> {
    const { error } = await callRpc(supabase, 'void_purchase', {
        p_id: id,
        p_reason: input.reason
    })
    assertNoError(error)
}

export async function supplierPurchaseHistory(
    supabase: AppSupabaseClient,
    supplierId: string,
    query: SupplierHistoryQuery
): Promise<SupplierPurchaseHistory> {
    const { data, error } = await callRpc(supabase, 'supplier_purchase_history', {
        p_supplier_id: supplierId,
        p_from: query.from,
        p_to: query.to
    })
    assertNoError(error)
    if (!data || typeof data !== 'object') throw notFound('Purchase history not found')
    const raw = data as {
        purchases?: {
            id: string
            po_number: string
            invoice_number: string | null
            received_at: string
            total_amount: number | string
        }[]
        total?: number | string
        products?: {
            product_id: string
            name: string
            quantity: number
            last_unit_cost: number | string
            average_unit_cost: number | string
        }[]
    }
    return {
        purchases: (raw.purchases ?? []).map(row => ({
            id: row.id,
            po_number: row.po_number,
            invoice_number: row.invoice_number,
            received_at: row.received_at,
            total_amount: Number(row.total_amount)
        })),
        total: Number(raw.total ?? 0),
        products: (raw.products ?? []).map(row => ({
            product_id: row.product_id,
            name: row.name,
            quantity: Number(row.quantity),
            last_unit_cost: Number(row.last_unit_cost),
            average_unit_cost: Number(row.average_unit_cost)
        }))
    }
}
