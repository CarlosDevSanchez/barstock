import { z } from 'zod'
import { money, nullableText, nullableUuid, requiredText, toNumber } from '@/lib/validation/common'

const purchaseItemSchema = z.object({
    product_id: z.guid(),
    quantity: z.preprocess(toNumber, z.number().int().positive({ message: 'validation.positive' })),
    unit_cost: money
})

export const purchaseReceiveSchema = z.object({
    supplier_id: z.guid(),
    items: z.array(purchaseItemSchema).min(1).max(100),
    invoice_number: nullableText(80),
    notes: nullableText(500),
    cash_session_id: nullableUuid
})
export type PurchaseReceive = z.infer<typeof purchaseReceiveSchema>

export const purchaseVoidSchema = z.object({
    reason: requiredText(500)
})
export type PurchaseVoid = z.infer<typeof purchaseVoidSchema>

export const supplierHistoryQuerySchema = z
    .object({
        from: z.iso.date(),
        to: z.iso.date()
    })
    .refine(value => value.from <= value.to, {
        path: ['to'],
        message: 'validation.invalidRange'
    })
export type SupplierHistoryQuery = z.infer<typeof supplierHistoryQuerySchema>
