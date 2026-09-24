import { z } from 'zod'
import { money, nullableText, optionalUuid } from '@/lib/validation/common'
import { PAYMENT_METHODS } from '@/lib/validation/resources'

const positiveMoney = money.refine(value => value > 0, 'validation.minZero')

/** Split-payment shape shared with sales (`method` + `amount`). */
const receivablePaymentSchema = z.object({
    method: z.enum(PAYMENT_METHODS),
    amount: positiveMoney
})

export const deferTabSchema = z.object({
    due_date: z.iso.date().nullable().optional(),
    reminder_enabled: z.boolean().default(false),
    reminder_note: nullableText(500)
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
    customer_id: optionalUuid
})
export type ListReceivablesQuery = z.infer<typeof listReceivablesQuerySchema>

export const receivableRowSchema = z.object({
    customer_name: z.string().nullable(),
    order_id: z.string(),
    order_number: z.string(),
    total: z.number(),
    paid: z.number(),
    balance: z.number(),
    due_date: z.string().nullable(),
    reminder_enabled: z.boolean(),
    status: z.string(),
    days_overdue: z.number()
})
export type ReceivableRow = z.infer<typeof receivableRowSchema>
