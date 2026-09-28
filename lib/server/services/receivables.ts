import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import type {
    DeferTabInput,
    ListReceivablesQuery,
    PayReceivableInput,
    ReceivableRow,
    UpdateReceivableInput,
    WriteOffReceivableInput
} from '@/lib/validation/receivables'
import { receivableRowSchema } from '@/lib/validation/receivables'
import { z } from 'zod'
import { assertMoneyScale } from './_shared'
import { getOrder, type OrderDetail } from './orders'

/** RPCs added in Phase E before `bun run db:types` regenerates `types/database.ts`. */
type UntypedRpc = {
    rpc(
        fn: string,
        args?: Record<string, unknown>
    ): PromiseLike<{ data: unknown; error: Parameters<typeof assertNoError>[0] }>
}

function rpc(supabase: AppSupabaseClient): UntypedRpc {
    return supabase as unknown as UntypedRpc
}

const payResultSchema = z.object({
    balance: z.number(),
    status: z.string()
})

export async function listReceivables(
    supabase: AppSupabaseClient,
    query: ListReceivablesQuery
): Promise<ReceivableRow[]> {
    const { data, error } = await rpc(supabase).rpc('list_receivables', {
        p_status: query.status ?? null,
        p_customer_id: query.customer_id ?? null,
        p_q: query.q ?? null
    })
    assertNoError(error)
    return z.array(receivableRowSchema).parse(data ?? [])
}

export async function deferTab(
    supabase: AppSupabaseClient,
    tabId: string,
    input: DeferTabInput,
    idempotencyKey: string
): Promise<OrderDetail> {
    if (input.payments) {
        const amounts: Record<string, number> = {}
        input.payments.forEach((payment, index) => {
            amounts[`payments.${index}.amount`] = payment.amount
        })
        await assertMoneyScale(supabase, amounts)
    }
    const { data, error } = await rpc(supabase).rpc('defer_tab', {
        p_tab_id: tabId,
        p_due_date: input.due_date,
        p_reminder: input.reminder_enabled,
        p_note: input.reminder_note ?? null,
        p_customer_id: input.customer_id ?? null,
        p_debtor_name: input.debtor_name ?? null,
        p_payments: input.payments ?? null,
        p_idempotency_key: idempotencyKey
    })
    assertNoError(error)
    return getOrder(supabase, data as string)
}

export async function payReceivable(
    supabase: AppSupabaseClient,
    orderId: string,
    input: PayReceivableInput,
    idempotencyKey?: string | null
): Promise<{ balance: number; status: string }> {
    const amounts: Record<string, number> = {}
    input.payments.forEach((payment, index) => {
        amounts[`payments.${index}.amount`] = payment.amount
    })
    await assertMoneyScale(supabase, amounts)
    const { data, error } = await rpc(supabase).rpc('pay_receivable', {
        p_order_id: orderId,
        p_payments: input.payments,
        p_idempotency_key: idempotencyKey ?? null
    })
    assertNoError(error)
    return payResultSchema.parse(data)
}

export async function updateReceivable(
    supabase: AppSupabaseClient,
    orderId: string,
    input: UpdateReceivableInput
): Promise<void> {
    const { error } = await rpc(supabase).rpc('update_receivable', {
        p_order_id: orderId,
        p_due_date: input.due_date ?? null,
        p_reminder: input.reminder_enabled,
        p_note: input.reminder_note ?? null
    })
    assertNoError(error)
}

export async function writeOffReceivable(
    supabase: AppSupabaseClient,
    orderId: string,
    input: WriteOffReceivableInput
): Promise<void> {
    const { error } = await rpc(supabase).rpc('write_off_receivable', {
        p_order_id: orderId,
        p_reason: input.reason
    })
    assertNoError(error)
}
