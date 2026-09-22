import { z } from 'zod'
import { PAYMENT_METHODS } from './resources'
import { blankToNull, money, nullableUuid, paginationSchema, positiveInt, requiredText } from './common'

const memberName = z.string().trim().min(1).max(80)
const reason = z.string().trim().min(3, 'validation.reasonRequired').max(500)
/** `money` allows 0; a payment or a line must be strictly positive. */
const positiveMoney = money.refine(value => value > 0, 'validation.minZero')

export const openTabSchema = z.object({
    label: requiredText(120),
    customer_id: nullableUuid,
    members: z.array(memberName).max(50).optional()
})

export const addTabMembersSchema = z.object({ names: z.array(memberName).min(1).max(50) })

export const addTabItemsSchema = z.object({
    items: z
        .array(
            z.object({
                product_id: z.guid(),
                variant_id: nullableUuid,
                quantity: positiveInt(100_000)
            })
        )
        .min(1, 'validation.cartEmpty')
        .max(200)
})

export const removeTabItemSchema = z.object({
    quantity: positiveInt(100_000),
    reason
})

export const setTabDiscountSchema = z.object({ discount: money })

export const payTabSchema = z.object({
    member_id: nullableUuid,
    payment_method: z.enum(PAYMENT_METHODS),
    amount: positiveMoney
})

export const voidTabSchema = z.object({ reason })

export const TAB_STATUSES = ['open', 'closed', 'voided'] as const
export const tabsQuerySchema = paginationSchema.extend({
    status: z.preprocess(value => blankToNull(value) ?? undefined, z.enum(TAB_STATUSES).optional())
})

export type OpenTabInput = z.output<typeof openTabSchema>
export type AddTabMembersInput = z.output<typeof addTabMembersSchema>
export type AddTabItemsInput = z.output<typeof addTabItemsSchema>
export type RemoveTabItemInput = z.output<typeof removeTabItemSchema>
export type SetTabDiscountInput = z.output<typeof setTabDiscountSchema>
export type PayTabInput = z.output<typeof payTabSchema>
export type VoidTabInput = z.output<typeof voidTabSchema>
export type TabsQuery = z.output<typeof tabsQuerySchema>
