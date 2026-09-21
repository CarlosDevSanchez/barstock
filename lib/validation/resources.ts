import { z } from 'zod'
import { USER_ROLES } from '@/lib/auth/roles'
import {
    money,
    nullableEmail,
    nullableText,
    nullableUrl,
    nullableUuid,
    positiveInt,
    requiredText,
    taxRate
} from './common'

// Only columns a client may write appear here: ids, timestamps, totals, loyalty and role are server-owned,
// and zod strips unknown keys (mass-assignment protection). Optional columns rely on DB defaults, so the
// *Update schemas are plain `.partial()` (zod defaults would silently reset fields on PATCH).

// ---- Auth
export const loginSchema = z.object({ email: z.email().toLowerCase(), password: z.string().min(1).max(72) })
export const forgotPasswordSchema = z.object({ email: z.email().toLowerCase() })
// 72 = bcrypt input limit
export const resetPasswordSchema = z.object({ password: z.string().min(10, 'At least 10 characters').max(72) })

// ---- Catalog
export const categoryCreateSchema = z.object({
    name: requiredText(120),
    description: nullableText(1000),
    parent_id: nullableUuid
})
export const categoryUpdateSchema = categoryCreateSchema.partial()

export const productCreateSchema = z.object({
    name: requiredText(200),
    description: nullableText(2000),
    sku: requiredText(64),
    barcode: nullableText(64),
    category_id: nullableUuid,
    cost_price: money.optional(),
    selling_price: money,
    tax_rate: taxRate.optional(),
    image_url: nullableUrl,
    is_active: z.boolean().optional()
})
export const productUpdateSchema = productCreateSchema.partial()

// ---- People
export const customerCreateSchema = z.object({
    name: requiredText(120),
    email: nullableEmail,
    phone: nullableText(40),
    address: nullableText(300),
    is_active: z.boolean().optional()
})
export const customerUpdateSchema = customerCreateSchema.partial()

export const supplierCreateSchema = z.object({
    name: requiredText(120),
    contact_person: nullableText(120),
    email: nullableEmail,
    phone: nullableText(40),
    address: nullableText(300),
    notes: nullableText(2000),
    is_active: z.boolean().optional()
})
export const supplierUpdateSchema = supplierCreateSchema.partial()

// ---- Inventory
export const inventoryAdjustSchema = z.object({
    delta: z
        .number()
        .int()
        .min(-1_000_000)
        .max(1_000_000)
        .refine(value => value !== 0, 'Delta must not be 0'),
    reason: z.string().trim().min(3, 'A reason is required').max(500)
})

// ---- Sales and refunds: the client sends ids and quantities only; prices, taxes and totals come from the DB.
export const PAYMENT_METHODS = ['cash', 'card', 'ewallet'] as const
export const saleSchema = z.object({
    customer_id: nullableUuid,
    items: z
        .array(
            z.object({
                product_id: z.uuid(),
                variant_id: nullableUuid,
                quantity: positiveInt(100_000),
                discount: money.optional()
            })
        )
        .min(1, 'The cart is empty')
        .max(100),
    payment_method: z.enum(PAYMENT_METHODS),
    discount: money.optional()
})
export const refundSchema = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(500) })

// ---- Users (admin only)
export const inviteUserSchema = z.object({
    email: z.email().max(254).toLowerCase(),
    full_name: nullableText(120),
    role: z.enum(USER_ROLES)
})
export const updateUserSchema = z
    .object({ role: z.enum(USER_ROLES).optional(), is_active: z.boolean().optional() })
    .refine(value => value.role !== undefined || value.is_active !== undefined, 'Nothing to update')

// ---- Settings (stored one JSONB value per key in `settings`)
// Intl.NumberFormat accepts any well-formed 3-letter code (even 'ZZZ'), so check against the known list.
const currencies = new Set(Intl.supportedValuesOf('currency'))
const isValidCurrency = (code: string) => currencies.has(code)
const isValidTimeZone = (zone: string) => {
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone })
        return true
    } catch {
        return false
    }
}
export const settingsSchema = z.object({
    store_name: requiredText(120),
    store_address: z.string().trim().max(300),
    store_phone: z.string().trim().max(40),
    store_email: z.union([z.literal(''), z.email().max(254)]),
    currency: z
        .string()
        .regex(/^[A-Z]{3}$/, 'ISO 4217 code')
        .refine(isValidCurrency, 'Unknown currency'),
    timezone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
    low_stock_threshold: z.preprocess(
        v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
        z.number().int().min(0).max(100_000)
    ),
    tax_rate: taxRate,
    receipt_template: z.object({ header: z.string().trim().max(200), footer: z.string().trim().max(200) })
})
export const settingsUpdateSchema = settingsSchema.partial()
export type SettingsInput = z.infer<typeof settingsSchema>
export type SettingKey = keyof SettingsInput
