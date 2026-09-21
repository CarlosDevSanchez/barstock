import { describe, expect, test } from 'bun:test'
import { Constants } from '@/types/database'
import {
    PAYMENT_METHODS,
    customerCreateSchema,
    inventoryAdjustSchema,
    inviteUserSchema,
    loginSchema,
    productCreateSchema,
    productUpdateSchema,
    refundSchema,
    resetPasswordSchema,
    saleSchema,
    settingsUpdateSchema,
    updateUserSchema
} from './resources'

const id = '11111111-1111-4111-8111-111111111111'

describe('products', () => {
    const base = { name: 'Beer', sku: 'BEER-1', selling_price: '3.50' }

    test("normalizes '' to null for barcode, category and image", () => {
        const parsed = productCreateSchema.parse({ ...base, barcode: '', category_id: '', image_url: '' })
        expect(parsed.barcode).toBeNull()
        expect(parsed.category_id).toBeNull()
        expect(parsed.image_url).toBeNull()
        expect(parsed.selling_price).toBe(3.5)
    })
    test('does not invent defaults for columns the DB defaults', () => {
        const parsed = productCreateSchema.parse(base)
        expect('cost_price' in parsed || 'tax_rate' in parsed || 'is_active' in parsed).toBe(false)
    })
    test('requires name, sku and price', () => {
        expect(productCreateSchema.safeParse({ name: 'x' }).success).toBe(false)
        expect(productCreateSchema.safeParse({ ...base, name: '  ' }).success).toBe(false)
    })
    test('strips server-owned keys (mass assignment)', () => {
        const parsed = productCreateSchema.parse({ ...base, id, created_at: 'x', deleted_at: 'x', role: 'admin' })
        expect(Object.keys(parsed).sort()).toEqual(['name', 'selling_price', 'sku'])
    })
    test('PATCH only carries the fields that were sent', () => {
        expect(productUpdateSchema.parse({ name: 'New' })).toEqual({ name: 'New' })
        expect(productUpdateSchema.parse({})).toEqual({})
    })
})

describe('customers', () => {
    test('cannot write derived loyalty fields', () => {
        const parsed = customerCreateSchema.parse({ name: 'Ann', email: '', total_spent: 1e6, loyalty_points: 99 })
        expect(parsed).toEqual({ name: 'Ann', email: null })
    })
})

describe('sales', () => {
    const line = { product_id: id, quantity: 2 }

    test('accepts ids and quantities only, and strips prices', () => {
        const parsed = saleSchema.parse({
            items: [{ ...line, unit_price: 0.01, total: 0 }],
            payment_method: 'cash',
            total: 0
        })
        expect(parsed.items[0]).toEqual({ product_id: id, quantity: 2 })
        expect('total' in parsed).toBe(false)
    })
    test('rejects empty carts, bad quantities, bad ids and unknown payment methods', () => {
        expect(saleSchema.safeParse({ items: [], payment_method: 'cash' }).success).toBe(false)
        expect(saleSchema.safeParse({ items: [{ ...line, quantity: 0 }], payment_method: 'cash' }).success).toBe(false)
        expect(saleSchema.safeParse({ items: [{ ...line, quantity: 1.5 }], payment_method: 'cash' }).success).toBe(
            false
        )
        expect(
            saleSchema.safeParse({ items: [{ product_id: 'nope', quantity: 1 }], payment_method: 'cash' }).success
        ).toBe(false)
        expect(saleSchema.safeParse({ items: [line], payment_method: 'bitcoin' }).success).toBe(false)
        expect(saleSchema.safeParse({ items: [line], payment_method: 'card', discount: -5 }).success).toBe(false)
    })
    test('accepts a blank customer as null', () => {
        expect(saleSchema.parse({ customer_id: '', items: [line], payment_method: 'card' }).customer_id).toBeNull()
    })
})

describe('refund and inventory adjustment require a reason', () => {
    test('refund', () => {
        expect(refundSchema.safeParse({}).success).toBe(false)
        expect(refundSchema.safeParse({ reason: 'ok' }).success).toBe(false)
        expect(refundSchema.parse({ reason: ' damaged item ' }).reason).toBe('damaged item')
    })
    test('adjustment: non-zero integer delta', () => {
        expect(inventoryAdjustSchema.safeParse({ delta: 0, reason: 'count' }).success).toBe(false)
        expect(inventoryAdjustSchema.safeParse({ delta: 1.5, reason: 'count' }).success).toBe(false)
        expect(inventoryAdjustSchema.safeParse({ delta: -3, reason: '' }).success).toBe(false)
        expect(inventoryAdjustSchema.parse({ delta: -3, reason: 'recount' })).toEqual({ delta: -3, reason: 'recount' })
    })
})

describe('users and auth', () => {
    test('invite requires a valid role and lowercases the email', () => {
        expect(inviteUserSchema.parse({ email: 'New@Shop.com', role: 'manager' }).email).toBe('new@shop.com')
        expect(inviteUserSchema.safeParse({ email: 'a@b.com', role: 'owner' }).success).toBe(false)
    })
    test('user update needs at least one field', () => {
        expect(updateUserSchema.safeParse({}).success).toBe(false)
        expect(updateUserSchema.safeParse({ is_active: false }).success).toBe(true)
        expect(updateUserSchema.safeParse({ role: 'root' }).success).toBe(false)
    })
    test('password rules', () => {
        expect(resetPasswordSchema.safeParse({ password: 'short' }).success).toBe(false)
        expect(resetPasswordSchema.safeParse({ password: 'x'.repeat(73) }).success).toBe(false)
        expect(resetPasswordSchema.safeParse({ password: 'a-long-enough-one' }).success).toBe(true)
    })
    test('login does not trim or limit passwords below 72 chars', () => {
        expect(loginSchema.parse({ email: 'A@B.com', password: ' pw ' })).toEqual({
            email: 'a@b.com',
            password: ' pw '
        })
    })
})

describe('settings', () => {
    test('validates currency, time zone and tax rate', () => {
        expect(settingsUpdateSchema.safeParse({ currency: 'EUR', timezone: 'Europe/Madrid' }).success).toBe(true)
        expect(settingsUpdateSchema.safeParse({ currency: 'usd' }).success).toBe(false)
        expect(settingsUpdateSchema.safeParse({ currency: 'ZZZ' }).success).toBe(false)
        expect(settingsUpdateSchema.safeParse({ timezone: 'Mars/Base' }).success).toBe(false)
        expect(settingsUpdateSchema.safeParse({ tax_rate: 10 }).success).toBe(false)
    })
    test('PATCH keeps only the sent keys', () => {
        expect(settingsUpdateSchema.parse({ store_name: 'Shop' })).toEqual({ store_name: 'Shop' })
    })
})

describe('enums stay in sync with the database', () => {
    test('payment_method', () => {
        expect([...PAYMENT_METHODS]).toEqual([...Constants.public.Enums.payment_method])
    })
})
