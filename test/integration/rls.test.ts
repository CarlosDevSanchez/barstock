import { beforeAll, describe, expect, test } from 'bun:test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
    adminClient,
    createCustomer,
    createProduct,
    ensureTestUsers,
    signedInClient,
    TEST_PASSWORD,
    uniq,
    type Db,
    type TestUsers
} from '../helpers/integration'

// These tests talk to Supabase exactly like an attacker with the public anon key and a valid login would (browser console):
// no application code in between, so what they prove is what the DATABASE enforces.

let users: TestUsers
let cashier: Db
let manager: Db
let admin: Db
let inactive: Db
const service = () => adminClient()

beforeAll(async () => {
    users = await ensureTestUsers()
    ;[cashier, manager, admin, inactive] = await Promise.all([
        signedInClient('cashier'),
        signedInClient('manager'),
        signedInClient('admin'),
        signedInClient('inactive')
    ])
})

const anonymous = () =>
    createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        {
            auth: { persistSession: false, autoRefreshToken: false }
        }
    )

const PERMISSION_DENIED = '42501'
const walkIn = null as unknown as string // the generated type says `string`; the function accepts NULL

describe('anonymous visitors', () => {
    test('read and write nothing', async () => {
        const anon = anonymous()
        for (const table of ['products', 'orders', 'customers', 'profiles', 'settings', 'inventory'] as const) {
            const { error } = await anon.from(table).select('*').limit(1)
            expect(error?.code).toBe(PERMISSION_DENIED)
        }
        expect((await anon.from('products').insert({ name: 'x', sku: uniq('S'), selling_price: 1 })).error?.code).toBe(
            PERMISSION_DENIED
        )
        expect(
            (await anon.rpc('create_sale', { p_customer_id: walkIn, p_items: [], p_payment_method: 'cash' })).error
                ?.code
        ).toBe(PERMISSION_DENIED)
        expect((await anon.rpc('dashboard_summary', {})).error?.code).toBe(PERMISSION_DENIED)
    })

    test('the public signup endpoint is closed', async () => {
        const { error } = await anonymous().auth.signUp({
            email: `${uniq('walkin')}@barstock.test`,
            password: TEST_PASSWORD
        })
        expect(error?.code).toBe('signup_disabled')
    })
})

describe('profiles: a cashier cannot escalate', () => {
    test('cannot change their own role or activation', async () => {
        const role = await cashier.from('profiles').update({ role: 'admin' }).eq('id', users.cashier.id)
        expect(role.error?.code).toBe(PERMISSION_DENIED)
        const active = await cashier.from('profiles').update({ is_active: false }).eq('id', users.cashier.id)
        expect(active.error?.code).toBe(PERMISSION_DENIED)
        const { data } = await service().from('profiles').select('role, is_active').eq('id', users.cashier.id).single()
        expect(data).toEqual({ role: 'cashier', is_active: true })
    })

    test('cannot change their id or email; may change harmless fields', async () => {
        expect(
            (await cashier.from('profiles').update({ email: 'new@barstock.test' }).eq('id', users.cashier.id)).error
                ?.code
        ).toBe(PERMISSION_DENIED)
        const name = uniq('Name')
        expect((await cashier.from('profiles').update({ full_name: name }).eq('id', users.cashier.id)).error).toBeNull()
        const { data } = await service().from('profiles').select('full_name').eq('id', users.cashier.id).single()
        expect(data?.full_name).toBe(name)
        await service().from('profiles').update({ full_name: null }).eq('id', users.cashier.id)
    })

    test('may change their own locale but not someone else’s', async () => {
        expect((await cashier.from('profiles').update({ locale: 'en' }).eq('id', users.cashier.id)).error).toBeNull()
        const own = await service().from('profiles').select('locale').eq('id', users.cashier.id).single()
        expect(own.data?.locale).toBe('en')

        const other = await cashier.from('profiles').update({ locale: 'en' }).eq('id', users.manager.id).select()
        expect(other.data ?? []).toHaveLength(0)
        const managerLocale = await service().from('profiles').select('locale').eq('id', users.manager.id).single()
        expect(managerLocale.data?.locale).toBe('es')

        await service().from('profiles').update({ locale: 'es' }).eq('id', users.cashier.id)
    })

    test('cannot create or delete profiles', async () => {
        expect((await cashier.from('profiles').insert({ id: crypto.randomUUID(), email: 'x@y.z' })).error?.code).toBe(
            PERMISSION_DENIED
        )
        const deleted = await cashier.from('profiles').delete().eq('id', users.manager.id).select()
        expect(deleted.data ?? []).toHaveLength(0)
        const { count } = await service()
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('id', users.manager.id)
        expect(count).toBe(1)
    })

    test('sees only their own profile; managers see everyone’s', async () => {
        const own = await cashier.from('profiles').select('id')
        expect(own.data).toEqual([{ id: users.cashier.id }])
        const all = await manager.from('profiles').select('id')
        expect((all.data ?? []).length).toBeGreaterThanOrEqual(4)
    })

    test('a manager cannot change other people’s roles (RLS hides the row: 0 rows, no error)', async () => {
        const result = await manager.from('profiles').update({ role: 'admin' }).eq('id', users.cashier.id).select()
        expect(result.data ?? []).toHaveLength(0)
        const { data } = await service().from('profiles').select('role').eq('id', users.cashier.id).single()
        expect(data?.role).toBe('cashier')
    })

    test('a manager cannot promote themselves either', async () => {
        const result = await manager.from('profiles').update({ role: 'admin' }).eq('id', users.manager.id)
        expect(result.error?.code).toBe(PERMISSION_DENIED)
    })

    test('an admin changes roles and activation', async () => {
        const created = await service().auth.admin.createUser({
            email: `${uniq('promote')}@barstock.test`,
            password: TEST_PASSWORD,
            email_confirm: true,
            app_metadata: { role: 'cashier' }
        })
        const id = created.data.user?.id ?? ''
        try {
            const promoted = await admin
                .from('profiles')
                .update({ role: 'manager' })
                .eq('id', id)
                .select('role')
                .single()
            expect(promoted.data?.role).toBe('manager')
            const disabled = await admin
                .from('profiles')
                .update({ is_active: false })
                .eq('id', id)
                .select('is_active')
                .single()
            expect(disabled.data?.is_active).toBe(false)
        } finally {
            await service().auth.admin.deleteUser(id)
        }
    })

    test('the last active admin cannot be demoted or disabled', async () => {
        // Make the test admin the only active admin for a moment, then put everything back.
        const { data: others } = await service()
            .from('profiles')
            .select('id')
            .eq('role', 'admin')
            .eq('is_active', true)
            .neq('id', users.admin.id)
        const otherIds = (others ?? []).map(row => row.id)
        if (otherIds.length) await service().from('profiles').update({ is_active: false }).in('id', otherIds)
        try {
            const demote = await admin.from('profiles').update({ role: 'manager' }).eq('id', users.admin.id)
            expect(demote.error?.message).toBe('The last active admin cannot be demoted or deactivated')
            const disable = await admin.from('profiles').update({ is_active: false }).eq('id', users.admin.id)
            expect(disable.error?.message).toBe('The last active admin cannot be demoted or deactivated')
        } finally {
            if (otherIds.length) await service().from('profiles').update({ is_active: true }).in('id', otherIds)
        }
    })
})

describe('the auth trigger: who becomes an active user', () => {
    const created: string[] = []
    const newUser = async (payload: {
        app_metadata?: Record<string, unknown>
        user_metadata?: Record<string, unknown>
    }) => {
        const result = await service().auth.admin.createUser({
            email: `${uniq('trigger')}@barstock.test`,
            password: TEST_PASSWORD,
            email_confirm: true,
            ...payload
        })
        const id = result.data.user?.id ?? ''
        created.push(id)
        const { data } = await service().from('profiles').select('role, is_active').eq('id', id).single()
        return { id, profile: data }
    }

    test('a role assigned by the server (app_metadata) creates an active profile with that role', async () => {
        for (const role of ['admin', 'manager', 'cashier'] as const) {
            expect((await newUser({ app_metadata: { role } })).profile).toEqual({ role, is_active: true })
        }
    })

    test('a role in user_metadata (editable by the user) is ignored: inactive cashier, no access', async () => {
        expect((await newUser({ user_metadata: { role: 'admin' } })).profile).toEqual({
            role: 'cashier',
            is_active: false
        })
    })

    test('an unknown role value never activates anybody', async () => {
        expect((await newUser({ app_metadata: { role: 'superuser' } })).profile).toEqual({
            role: 'cashier',
            is_active: false
        })
    })

    test('changing the role in app_metadata later applies it and activates', async () => {
        const { id } = await newUser({ user_metadata: {} })
        await service().auth.admin.updateUserById(id, { app_metadata: { role: 'manager' } })
        const { data } = await service().from('profiles').select('role, is_active').eq('id', id).single()
        expect(data).toEqual({ role: 'manager', is_active: true })
    })

    test('an unrelated app_metadata update never reverts a role change or reactivates a disabled user', async () => {
        const { id } = await newUser({ app_metadata: { role: 'manager' } })
        await service().from('profiles').update({ role: 'cashier', is_active: false }).eq('id', id)
        await service().auth.admin.updateUserById(id, { app_metadata: { role: 'manager', note: 'unrelated' } })
        const { data } = await service().from('profiles').select('role, is_active').eq('id', id).single()
        expect(data).toEqual({ role: 'cashier', is_active: false })
    })

    test('cleanup', async () => {
        for (const id of created) await service().auth.admin.deleteUser(id)
    })
})

describe('sales and stock can only change through the RPCs', () => {
    test.each([
        ['cashier', () => cashier],
        ['manager', () => manager],
        ['admin', () => admin]
    ] as const)(
        '%s cannot write orders, items, payments, inventory or stock movements directly',
        async (_role, client) => {
            const db = client()
            const product = await createProduct({ stock: 5 })
            const orderId = crypto.randomUUID()
            expect(
                (await db.from('orders').insert({ id: orderId, order_number: uniq('X'), status: 'completed' })).error
                    ?.code
            ).toBe(PERMISSION_DENIED)
            expect(
                (
                    await db
                        .from('order_items')
                        .insert({ order_id: orderId, product_id: product.id, quantity: 1, unit_price: 1, total: 1 })
                ).error?.code
            ).toBe(PERMISSION_DENIED)
            expect(
                (await db.from('payments').insert({ order_id: orderId, payment_method: 'cash', amount: 1 })).error?.code
            ).toBe(PERMISSION_DENIED)
            expect(
                (await db.from('inventory').update({ quantity: 9999 }).eq('product_id', product.id)).error?.code
            ).toBe(PERMISSION_DENIED)
            expect(
                (await db.from('inventory').insert({ product_id: crypto.randomUUID(), quantity: 1 })).error?.code
            ).toBe(PERMISSION_DENIED)
            expect((await db.from('inventory').delete().eq('product_id', product.id)).error?.code).toBe(
                PERMISSION_DENIED
            )
            expect(
                (
                    await db
                        .from('inventory_transactions')
                        .insert({ inventory_id: crypto.randomUUID(), transaction_type: 'sale', quantity: -1 })
                ).error?.code
            ).toBe(PERMISSION_DENIED)
            const { data } = await service().from('inventory').select('quantity').eq('product_id', product.id).single()
            expect(data?.quantity).toBe(5)
        }
    )

    test('a completed order cannot be edited, and orders and payments cannot be deleted or altered', async () => {
        const product = await createProduct({ stock: 5 })
        const sale = await cashier.rpc('create_sale', {
            p_customer_id: walkIn,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_payment_method: 'cash'
        })
        const orderId = sale.data ?? ''
        expect(orderId).not.toBe('')
        expect(
            (await admin.from('orders').update({ total: 0.01, status: 'pending' }).eq('id', orderId)).error?.code
        ).toBe(PERMISSION_DENIED)
        expect((await admin.from('orders').delete().eq('id', orderId)).error?.code).toBe(PERMISSION_DENIED)
        expect((await manager.from('payments').update({ amount: 0 }).eq('order_id', orderId)).error?.code).toBe(
            PERMISSION_DENIED
        )
    })

    test('the internal helpers are not callable by API users', async () => {
        const { error } = await cashier.rpc('refresh_customer_totals', { p_customer_id: crypto.randomUUID() })
        expect(error?.code).toBe(PERMISSION_DENIED)
    })
})

describe('role matrix on catalog, people and settings', () => {
    test('a cashier cannot write the catalog; forbidden UPDATE/DELETE silently affect 0 rows', async () => {
        const product = await createProduct()
        expect(
            (await cashier.from('products').insert({ name: 'x', sku: uniq('S'), selling_price: 1 })).error?.code
        ).toBe(PERMISSION_DENIED)
        const updated = await cashier.from('products').update({ name: 'hacked' }).eq('id', product.id).select()
        const deleted = await cashier.from('products').delete().eq('id', product.id).select()
        expect(updated.data ?? []).toHaveLength(0)
        expect(deleted.data ?? []).toHaveLength(0)
        const { data } = await service().from('products').select('name').eq('id', product.id).single()
        expect(data?.name).toBe(product.name)
    })

    test('even a manager cannot hard-delete a product; an admin can', async () => {
        const product = await createProduct()
        expect((await manager.from('products').delete().eq('id', product.id).select()).data ?? []).toHaveLength(0)
        expect((await admin.from('products').delete().eq('id', product.id).select('id')).data).toHaveLength(1)
    })

    test('cashiers do not see soft-deleted products; managers do', async () => {
        const product = await createProduct()
        await service().from('products').update({ deleted_at: new Date().toISOString() }).eq('id', product.id)
        expect((await cashier.from('products').select('id').eq('id', product.id)).data).toEqual([])
        expect((await manager.from('products').select('id').eq('id', product.id)).data).toHaveLength(1)
    })

    test('cashiers cannot see suppliers, expenses, purchasing or stock movements', async () => {
        await service()
            .from('suppliers')
            .insert({ name: uniq('Sup') })
        for (const table of [
            'suppliers',
            'expenses',
            'purchase_orders',
            'purchase_order_items',
            'inventory_transactions'
        ] as const) {
            expect((await cashier.from(table).select('*')).data ?? []).toHaveLength(0)
        }
        expect(((await manager.from('suppliers').select('*')).data ?? []).length).toBeGreaterThan(0)
        expect((await cashier.from('suppliers').insert({ name: 'x' })).error?.code).toBe(PERMISSION_DENIED)
    })

    test('settings: everyone reads, only admins write', async () => {
        expect(((await cashier.from('settings').select('key')).data ?? []).length).toBeGreaterThan(0)
        expect(
            (await cashier.from('settings').update({ value: '"x"' }).eq('key', 'store_name').select()).data ?? []
        ).toHaveLength(0)
        expect(
            (await manager.from('settings').update({ value: '"x"' }).eq('key', 'store_name').select()).data ?? []
        ).toHaveLength(0)
        expect((await cashier.from('settings').insert({ key: uniq('k'), value: 1 })).error?.code).toBe(
            PERMISSION_DENIED
        )
        const { data } = await service().from('settings').select('value').eq('key', 'store_name').single()
        expect(data?.value).not.toBe('x')
    })

    test('customers: everyone edits contact data, nobody but the server touches the derived columns', async () => {
        const customer = await createCustomer()
        expect((await cashier.from('customers').update({ name: 'Renamed' }).eq('id', customer.id)).error).toBeNull()
        for (const patch of [{ total_spent: 1_000_000 }, { loyalty_points: 99_999 }]) {
            expect((await cashier.from('customers').update(patch).eq('id', customer.id)).error?.code).toBe(
                PERMISSION_DENIED
            )
            expect((await admin.from('customers').update(patch).eq('id', customer.id)).error?.code).toBe(
                PERMISSION_DENIED
            )
        }
        expect((await cashier.from('customers').insert({ name: 'x', total_spent: 5 })).error?.code).toBe(
            PERMISSION_DENIED
        )
        expect((await cashier.from('customers').delete().eq('id', customer.id).select()).data ?? []).toHaveLength(0)
        expect((await admin.from('customers').delete().eq('id', customer.id).select('id')).data).toHaveLength(1)
    })
})

describe('order visibility', () => {
    test('a cashier sees only their own orders, items and payments; managers see all', async () => {
        const product = await createProduct({ stock: 10 })
        const items = [{ product_id: product.id, quantity: 1 }]
        const mine =
            (await cashier.rpc('create_sale', { p_customer_id: walkIn, p_items: items, p_payment_method: 'cash' }))
                .data ?? ''
        const theirs =
            (await manager.rpc('create_sale', { p_customer_id: walkIn, p_items: items, p_payment_method: 'card' }))
                .data ?? ''

        expect((await cashier.from('orders').select('id').in('id', [mine, theirs])).data).toEqual([{ id: mine }])
        expect((await cashier.from('order_items').select('order_id').in('order_id', [mine, theirs])).data).toEqual([
            { order_id: mine }
        ])
        expect((await cashier.from('payments').select('order_id').in('order_id', [mine, theirs])).data).toEqual([
            { order_id: mine }
        ])
        expect((await manager.from('orders').select('id').in('id', [mine, theirs])).data).toHaveLength(2)
        expect((await admin.from('payments').select('order_id').in('order_id', [mine, theirs])).data).toHaveLength(2)
    })
})

describe('a disabled account has no access at all', () => {
    test('it reads nothing and cannot call the RPCs', async () => {
        for (const table of ['products', 'customers', 'settings', 'inventory', 'orders', 'profiles'] as const) {
            expect((await inactive.from(table).select('*')).data ?? []).toHaveLength(0)
        }
        const product = await createProduct({ stock: 3 })
        const sale = await inactive.rpc('create_sale', {
            p_customer_id: walkIn,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_payment_method: 'cash'
        })
        expect(sale.error?.code).toBe(PERMISSION_DENIED)
        expect((await inactive.rpc('dashboard_summary', {})).error?.code).toBe(PERMISSION_DENIED)
        expect((await inactive.from('customers').insert({ name: 'x' })).error?.code).toBe(PERMISSION_DENIED)
    })
})

describe('data integrity rules the database enforces on its own', () => {
    const CHECK_VIOLATION = '23514'
    const UNIQUE_VIOLATION = '23505'

    test('negative prices, out-of-range tax and negative stock are refused', async () => {
        const db = service()
        const base = { name: uniq('P') }
        expect((await db.from('products').insert({ ...base, sku: uniq('S'), selling_price: -1 })).error?.code).toBe(
            CHECK_VIOLATION
        )
        expect(
            (await db.from('products').insert({ ...base, sku: uniq('S'), selling_price: 1, tax_rate: 10 })).error?.code
        ).toBe(CHECK_VIOLATION)
        const product = await createProduct({ stock: 1 })
        expect((await db.from('inventory').update({ quantity: -1 }).eq('product_id', product.id)).error?.code).toBe(
            CHECK_VIOLATION
        )
    })

    test('a product can have only one inventory row without variant', async () => {
        const product = await createProduct()
        expect((await service().from('inventory').insert({ product_id: product.id, quantity: 1 })).error?.code).toBe(
            UNIQUE_VIOLATION
        )
    })

    test('order arithmetic must add up (new rows are checked)', async () => {
        const db = service()
        const bad = await db
            .from('orders')
            .insert({ order_number: uniq('BAD'), status: 'completed', subtotal: 10, tax: 1, discount: 0, total: 5 })
        expect(bad.error?.code).toBe(CHECK_VIOLATION)
        const good = await db
            .from('orders')
            .insert({ order_number: uniq('GOOD'), status: 'completed', subtotal: 10, tax: 1, discount: 2, total: 9 })
            .select('id')
            .single()
        expect(good.error).toBeNull()
        const product = await createProduct()
        const item = await db.from('order_items').insert({
            order_id: good.data?.id ?? '',
            product_id: product.id,
            quantity: 2,
            unit_price: 5,
            discount: 0,
            tax: 1,
            total: 99
        })
        expect(item.error?.code).toBe(CHECK_VIOLATION)
    })

    test('ownership columns are NOT NULL: an item cannot exist without its order', async () => {
        const product = await createProduct()
        const item = await service()
            .from('order_items')
            .insert({ product_id: product.id, quantity: 1, unit_price: 1, total: 1 } as never)
        expect(item.error?.code).toBe('23502')
    })
})
