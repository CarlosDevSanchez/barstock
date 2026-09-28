import { z } from 'zod'
import { money, nullableUuid, paginationSchema, requiredText } from '@/lib/validation/common'
import { PAYMENT_METHODS } from '@/lib/validation/resources'

export const expenseCreateSchema = z
    .object({
        category_id: z.guid(),
        description: requiredText(500),
        amount: money.refine(value => value > 0, 'validation.positive'),
        payment_method: z.enum(PAYMENT_METHODS),
        occurred_at: z.iso.datetime().nullable().optional(),
        supplier_id: nullableUuid,
        cash_session_id: nullableUuid
    })
    .refine(value => value.cash_session_id == null || value.payment_method === 'cash', {
        path: ['payment_method'],
        message: 'validation.tillExpenseCash'
    })
export type ExpenseCreate = z.infer<typeof expenseCreateSchema>

export const expenseVoidSchema = z.object({
    reason: requiredText(500)
})
export type ExpenseVoid = z.infer<typeof expenseVoidSchema>

export const expensesQuerySchema = paginationSchema
    .omit({ q: true })
    .extend({
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        category_id: z.guid().optional()
    })
    .refine(value => !value.from || !value.to || value.from <= value.to, {
        path: ['to'],
        message: 'validation.invalidRange'
    })
export type ExpensesQuery = z.infer<typeof expensesQuerySchema>

export const expenseCategoryCreateSchema = z.object({
    name: requiredText(80)
})
export type ExpenseCategoryCreate = z.infer<typeof expenseCategoryCreateSchema>
