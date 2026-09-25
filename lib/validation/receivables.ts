import { z } from 'zod'
import { blankToNull, money, nullableText, nullableUuid, optionalUuid } from '@/lib/validation/common'
import { PAYMENT_METHODS } from '@/lib/validation/resources'

const positiveMoney = money.refine(value => value > 0, 'validation.minZero')

/** Split-payment shape shared with sales (`method` + `amount`). */
const receivablePaymentSchema = z.object({
    method: z.enum(PAYMENT_METHODS),
    amount: positiveMoney
})

export const deferTabSchema = z.object({
    due_date: z.iso.date(),
    reminder_enabled: z.boolean().default(false),
    reminder_note: nullableText(500),
    customer_id: nullableUuid,
    // Blank → null before the length check. customer_id|debtor_name is NOT refined here: the tab may already
    // have a customer, which this schema cannot see — the DB raises 'A customer or debtor name is required'.
    debtor_name: z.preprocess(blankToNull, z.string().trim().min(2).max(120).nullable().optional()),
    payments: z.array(receivablePaymentSchema).min(1).max(2).optional()
})
export type DeferTabInput = z.infer<typeof deferTabSchema>

export const payReceivableSchema = z.object({
    payments: z.array(receivablePaymentSchema).min(1).max(2)
})
export type PayReceivableInput = z.infer<typeof payReceivableSchema>

export const updateReceivableSchema = z.object({
    due_date: z.iso.date().nullable().optional(),
    reminder_enabled: z.boolean(),
    reminder_note: nullableText(500)
})
export type UpdateReceivableInput = z.infer<typeof updateReceivableSchema>

export const writeOffReceivableSchema = z.object({
    reason: z.string().trim().min(3, 'validation.reasonRequired').max(500)
})
export type WriteOffReceivableInput = z.infer<typeof writeOffReceivableSchema>

export const listReceivablesQuerySchema = z.object({
    status: z.enum(['pending', 'written_off']).optional(),
    customer_id: optionalUuid,
    q: z.preprocess(value => blankToNull(value) ?? undefined, z.string().trim().max(100).optional())
})
export type ListReceivablesQuery = z.infer<typeof listReceivablesQuerySchema>

export const receivableRowSchema = z.object({
    customer_name: z.string().nullable(),
    debtor_name: z.string().nullable(),
    customer_id: z.string().nullable(),
    order_id: z.string(),
    order_number: z.string(),
    total: z.number(),
    paid: z.number(),
    balance: z.number(),
    due_date: z.string().nullable(),
    reminder_enabled: z.boolean(),
    reminder_note: z.string().nullable(),
    status: z.string(),
    days_overdue: z.number()
})
export type ReceivableRow = z.infer<typeof receivableRowSchema>
