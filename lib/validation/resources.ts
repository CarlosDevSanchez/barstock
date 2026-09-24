import { z } from 'zod'
import { USER_ROLES } from '@/lib/auth/roles'
import {
    blankToNull,
    money,
    numberField,
    toNumber,
    optionalUuid,
    paginationSchema,
    queryBoolean,
    uuidList,
    nullableEmail,
    nullableText,
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
export const resetPasswordSchema = z.object({ password: z.string().min(10, 'validation.minPassword').max(72) })

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
    // image_url is legacy (unused, kept in the DB) and image_key is server-generated (never client-writable): see
    // app/api/v1/products/[id]/image/route.ts and lib/server/storage.ts.
    is_active: z.boolean().optional()
})
export const productUpdateSchema = productCreateSchema.partial()

/** One product line inside a fixed-price package. Unique product_id per promotion (enforced here + DB UNIQUE). */
export const promotionItemSchema = z.object({
    product_id: z.guid(),
    quantity: positiveInt(100_000)
})

const uniqueProductIds = (items: Array<{ product_id: string }>, ctx: z.RefinementCtx) => {
    const seen = new Set<string>()
    for (let i = 0; i < items.length; i++) {
        const productId = items[i]!.product_id
        if (seen.has(productId)) {
            ctx.addIssue({ code: 'custom', message: 'validation.duplicateProduct', path: [i, 'product_id'] })
        }
        seen.add(productId)
    }
}

export const promotionCreateSchema = z.object({
    name: requiredText(200),
    package_price: money,
    is_active: z.boolean().optional(),
    items: z.array(promotionItemSchema).min(1, 'validation.itemsRequired').max(50).superRefine(uniqueProductIds)
})
export const promotionUpdateSchema = promotionCreateSchema.partial()

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
    // A number input delivers a string: convert it (and never treat '' as 0).
    delta: z.preprocess(
        toNumber,
        numberField()
            .int('validation.wholeNumber')
            .min(-1_000_000, 'validation.tooSmall')
            .max(1_000_000, 'validation.tooLarge')
            .refine(value => value !== 0, 'validation.nonzero')
    ),
    reason: z.string().trim().min(3, 'validation.reasonRequired').max(500)
})

// ---- Sales and refunds: the client sends ids and quantities only; prices, taxes and totals come from the DB.
// Each line is either a product (optional line discount) or a promotion package — never both (expanded in create_sale).
export const PAYMENT_METHODS = ['cash', 'card', 'ewallet'] as const
export const saleItemSchema = z
    .object({
        product_id: z.guid().optional(),
        promotion_id: z.guid().optional(),
        variant_id: nullableUuid,
        quantity: positiveInt(100_000),
        discount: money.optional()
    })
    .superRefine((value, ctx) => {
        const hasProduct = value.product_id !== undefined
        const hasPromo = value.promotion_id !== undefined
        if (hasProduct === hasPromo) {
            ctx.addIssue({ code: 'custom', message: 'validation.saleItemXor' })
        }
    })
    .transform(value => {
        if (value.promotion_id !== undefined) {
            return { promotion_id: value.promotion_id, quantity: value.quantity }
        }
        return {
            product_id: value.product_id as string,
            ...(value.variant_id !== undefined ? { variant_id: value.variant_id } : {}),
            quantity: value.quantity,
            ...(value.discount !== undefined ? { discount: value.discount } : {})
        }
    })
export const saleSchema = z.object({
    customer_id: nullableUuid,
    items: z.array(saleItemSchema).min(1, 'validation.cartEmpty').max(100),
    payment_method: z.enum(PAYMENT_METHODS),
    discount: money.optional(),
    // Offline sales only (F2, docs/06-roadmap/offline-y-sincronizacion.md): when the device rang this up without a
    // network connection. `occurred_at` is the device's clock at the time; `expected_total` is the provisional total
    // it showed — the server always recalculates and only records the difference (`sync_issues.price_mismatch`).
    occurred_at: z.iso.datetime().optional(),
    expected_total: money.optional()
})
export const refundSchema = z.object({ reason: z.string().trim().min(3, 'validation.reasonRequired').max(500) })
// A manager's decision to discard a queued (never-synced) offline sale: logged to the audit trail, not the order
// itself (there is none - it never reached the server). See lib/offline/outbox.ts, components/offline/sync-center.tsx.
export const outboxDiscardSchema = z.object({
    provisional_number: z.string().trim().min(1).max(40),
    expected_total: money,
    payment_method: z.enum(PAYMENT_METHODS),
    reason: z.string().trim().min(3, 'validation.reasonRequired').max(500)
})

// ---- Users (admin only)
export const inviteUserSchema = z.object({
    email: z.email().max(254).toLowerCase(),
    full_name: nullableText(120),
    role: z.enum(USER_ROLES)
})
export const updateUserSchema = z
    .object({ role: z.enum(USER_ROLES).optional(), is_active: z.boolean().optional() })
    .refine(value => value.role !== undefined || value.is_active !== undefined, 'validation.nothingToUpdate')

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
    // Colombia: NIT (tax id) printed on the receipt. Optional: not every store has entered it yet.
    store_tax_id: z.string().trim().max(30),
    // Storage key for the receipt/sidebar logo (Phase 6 uploads it; this phase only reserves the field, so it is
    // usually empty).
    store_logo_key: z.string().trim().max(200),
    currency: z
        .string()
        .regex(/^[A-Z]{3}$/, 'validation.currencyCode')
        .refine(isValidCurrency, 'validation.unknownCurrency'),
    timezone: z.string().refine(isValidTimeZone, 'validation.unknownTimezone'),
    low_stock_threshold: z.preprocess(
        toNumber,
        numberField().int('validation.wholeNumber').min(0, 'validation.minZero').max(100_000, 'validation.tooLarge')
    ),
    tax_rate: taxRate,
    // How long a till may operate offline before create_sale clamps an offline sale's occurred_at to this window
    // (sync_issues.occurred_at_clamped). See F2, docs/06-roadmap/offline-y-sincronizacion.md.
    offline_max_hours: z.preprocess(
        toNumber,
        numberField().int('validation.wholeNumber').min(1, 'validation.minOne').max(168, 'validation.tooLarge')
    ),
    receipt_template: z.object({ header: z.string().trim().max(200), footer: z.string().trim().max(200) })
})
// store_logo_key is server-generated (never client-writable): see app/api/v1/settings/logo/route.ts and
// lib/server/storage.ts. It stays in `settingsSchema` (getSettings validates whatever is stored under that key).
export const settingsUpdateSchema = settingsSchema.omit({ store_logo_key: true }).partial()
export type SettingsInput = z.infer<typeof settingsSchema>
export type SettingKey = keyof SettingsInput

// ---- Query strings
export const ORDER_STATUSES = ['draft', 'pending', 'completed', 'refunded'] as const
const optionalDate = z.preprocess(value => blankToNull(value) ?? undefined, z.iso.date().optional())

export const productsQuerySchema = paginationSchema.extend({
    category_id: optionalUuid,
    active: queryBoolean,
    // Refreshes specific products (e.g. the current cart) with their live price and stock.
    ids: uuidList
})
export const promotionsQuerySchema = paginationSchema.extend({
    active: queryBoolean,
    ids: uuidList
})
export const inventoryQuerySchema = paginationSchema.extend({ low: queryBoolean })
export const topProductsQuerySchema = z.object({
    days: positiveInt(366).default(30),
    limit: positiveInt(20).default(5)
})
export const ordersQuerySchema = paginationSchema.extend({
    status: z.preprocess(value => blankToNull(value) ?? undefined, z.enum(ORDER_STATUSES).optional()),
    customer_id: optionalUuid,
    from: optionalDate,
    to: optionalDate,
    // Offline sales that synced with a difference (F4): sync_issues is not null and no manager has reviewed it yet.
    needs_review: queryBoolean
})

export const AUDIT_ACTIONS = [
    'insert',
    'update',
    'delete',
    'login',
    'login_failed',
    'logout',
    'invite',
    'password_reset',
    'discard'
] as const
export const auditQuerySchema = paginationSchema.omit({ q: true }).extend({
    actor_id: optionalUuid,
    action: z.preprocess(value => blankToNull(value) ?? undefined, z.enum(AUDIT_ACTIONS).optional()),
    entity: z.preprocess(value => blankToNull(value) ?? undefined, z.string().trim().max(100).optional()),
    from: optionalDate,
    to: optionalDate
})
export const reportQuerySchema = z.object({ from: z.iso.date(), to: z.iso.date() })

// ---- Inferred inputs (what services receive after validation)
export type ProductCreate = z.output<typeof productCreateSchema>
export type ProductUpdate = z.output<typeof productUpdateSchema>
export type PromotionCreate = z.output<typeof promotionCreateSchema>
export type PromotionUpdate = z.output<typeof promotionUpdateSchema>
export type CategoryCreate = z.output<typeof categoryCreateSchema>
export type CategoryUpdate = z.output<typeof categoryUpdateSchema>
export type CustomerCreate = z.output<typeof customerCreateSchema>
export type CustomerUpdate = z.output<typeof customerUpdateSchema>
export type SupplierCreate = z.output<typeof supplierCreateSchema>
export type SupplierUpdate = z.output<typeof supplierUpdateSchema>
export type SaleInput = z.output<typeof saleSchema>
export type OutboxDiscardInput = z.output<typeof outboxDiscardSchema>
export type InviteUserInput = z.output<typeof inviteUserSchema>
export type UpdateUserInput = z.output<typeof updateUserSchema>
export type ProductsQuery = z.output<typeof productsQuerySchema>
export type PromotionsQuery = z.output<typeof promotionsQuerySchema>
export type TopProductsQuery = z.output<typeof topProductsQuerySchema>
export type InventoryQuery = z.output<typeof inventoryQuerySchema>
export type OrdersQuery = z.output<typeof ordersQuerySchema>
export type AuditQuery = z.output<typeof auditQuerySchema>
