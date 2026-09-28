import { z } from 'zod'
import { money, nullableText, queryBoolean, requiredText } from './common'

const positiveMoney = money.refine(value => value > 0, 'validation.minZero')
const timestamp = z.string().refine(value => !Number.isNaN(Date.parse(value)), 'validation.invalidDate')

export const openBusinessDaySchema = z.object({ notes: nullableText(500) })
export const closeBusinessDaySchema = z.object({ notes: nullableText(500) })
export const adjustBusinessDaySchema = z.object({
    opened_at: timestamp,
    closed_at: z.preprocess(value => (value === '' || value === undefined ? null : value), timestamp.nullable()),
    notes: nullableText(500)
})
export const businessDaysQuerySchema = z.object({ needs_review: queryBoolean })
export const registerCreateSchema = z.object({ name: requiredText(80) })
export const openCashSessionSchema = z.object({
    register_id: z.guid(),
    opening_float: money,
    user_ids: z.array(z.guid()).min(1, 'validation.required').max(20)
})
export const cashMovementSchema = z.object({
    kind: z.enum(['deposit', 'withdrawal']),
    amount: positiveMoney,
    reason: requiredText(200)
})
export const closeCashSessionSchema = z.object({
    counted_cash: money,
    notes: nullableText(500)
})

const paymentTotal = z.object({
    payment_method: z.string(),
    order_count: z.number(),
    total: z.number()
})
const reportSession = z.object({
    session_id: z.string(),
    register_name: z.string(),
    opening_float: z.number(),
    expected_cash: z.number().nullable(),
    counted_cash: z.number().nullable(),
    difference: z.number().nullable(),
    needs_review: z.boolean(),
    status: z.string()
})

export const businessDayReportSchema = z.object({
    business_day_id: z.string(),
    opened_at: z.string(),
    closed_at: z.string().nullable(),
    close_kind: z.string().nullable(),
    needs_review: z.boolean(),
    total_orders: z.number(),
    total_revenue: z.number(),
    sales_without_register: z.number(),
    payments_by_method: z.array(paymentTotal),
    sessions: z.array(reportSession)
})

export type BusinessDayReport = z.infer<typeof businessDayReportSchema>
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>
export type CashMovementInput = z.infer<typeof cashMovementSchema>
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>
export type AdjustBusinessDayInput = z.infer<typeof adjustBusinessDaySchema>
