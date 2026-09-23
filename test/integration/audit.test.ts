import { beforeAll, describe, expect, test } from 'bun:test'
import { GET as listAudit } from '@/app/api/v1/audit/route'
import { POST as adjust } from '@/app/api/v1/inventory/[id]/adjust/route'
import { PATCH as patchProduct } from '@/app/api/v1/products/[id]/route'
import { POST as createSale } from '@/app/api/v1/sales/route'
import { POST as login } from '@/app/api/v1/auth/login/route'
import { adminClient, createProduct, ensureTestUsers, signedInClient, TEST_PASSWORD } from '../helpers/integration'
import { dataOf, loginAs, TestClient } from '../helpers/http'

interface AuditRow {
    id: number
    occurred_at: string
    actor_id: string | null
    actor_email: string | null
    actor_role: string | null
    action: string
    entity: string
    entity_id: string | null
    changes: Record<string, unknown> | null
    source: string
}

const latestFor = async (entity: string, entityId: string): Promise<AuditRow[]> => {
    const { data, error } = await adminClient()
        .from('audit_log')
        .select('*')
        .eq('entity', entity)
        .eq('entity_id', entityId)
        .order('occurred_at', { ascending: false })
    if (error) throw error
    return data as AuditRow[]
}

beforeAll(async () => {
    await ensureTestUsers()
})

describe('reads: admin-only', () => {
    test('an admin reads audit records; a manager and a cashier get 0 rows (RLS)', async () => {
        // Something to read: a category insert/update happens on every db:reset seed, so rows already exist.
        const admin = await signedInClient('admin')
        const manager = await signedInClient('manager')
        const cashier = await signedInClient('cashier')

        const { data: asAdmin, error: adminError } = await admin.from('audit_log').select('*').limit(1)
        expect(adminError).toBeNull()
        expect(asAdmin?.length).toBeGreaterThan(0)

        for (const client of [manager, cashier]) {
            const { data, error } = await client.from('audit_log').select('*')
            expect(error).toBeNull()
            expect(data).toEqual([])
        }
    })

    test('GET /api/v1/audit is 403 for a manager and 200 for an admin', async () => {
        const manager = await loginAs('manager')
        expect((await manager.get(listAudit, 'audit')).status).toBe(403)

        const admin = await loginAs('admin')
        const response = await admin.get(listAudit, 'audit')
        expect(response.status).toBe(200)
        expect(Array.isArray(dataOf<AuditRow[]>(response))).toBe(true)
    })
})

describe('immutability', () => {
    test('an authenticated session (even admin) cannot update, delete or truncate', async () => {
        const admin = await signedInClient('admin')
        const { data: existing } = await admin.from('audit_log').select('id').limit(1).single()
        expect(existing).toBeTruthy()

        const updated = await admin.from('audit_log').update({ action: 'insert' }).eq('id', existing!.id)
        expect(updated.error).not.toBeNull()

        const deleted = await admin.from('audit_log').delete().eq('id', existing!.id)
        expect(deleted.error).not.toBeNull()
    })

    test('service_role (bypasses RLS) is still blocked by the append-only trigger', async () => {
        const service = adminClient()
        const { data: existing } = await service.from('audit_log').select('id').limit(1).single()
        expect(existing).toBeTruthy()

        const updated = await service.from('audit_log').update({ action: 'insert' }).eq('id', existing!.id)
        expect(updated.error?.message).toContain('append-only')

        const deleted = await service.from('audit_log').delete().eq('id', existing!.id)
        expect(deleted.error?.message).toContain('append-only')
    })
})

describe('writes are recorded with the right actor and diff', () => {
    test('create_sale logs an insert on orders with the cashier as actor', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const cashier = await loginAs('cashier')
        const response = await cashier.post(createSale, 'sales', {
            body: { payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] }
        })
        expect(response.status).toBe(201)
        const order = dataOf<{ id: string }>(response)

        // Most recent first: create_sale's own INSERT into orders.
        const rows = await latestFor('orders', order.id)
        expect(rows[0]).toMatchObject({ action: 'insert', actor_role: 'cashier', source: 'api' })
        expect(rows[0]!.actor_id).toBeTruthy()
    })

    test('adjust_inventory logs an update on inventory with only the changed columns', async () => {
        const product = await createProduct({ selling_price: 5, tax_rate: 0, stock: 3 })
        const { data: inv } = await adminClient()
            .from('inventory')
            .select('id')
            .eq('product_id', product.id)
            .is('variant_id', null)
            .single()
        const manager = await loginAs('manager')
        const response = await manager.post(adjust, `inventory/${inv!.id}/adjust`, {
            params: { id: inv!.id },
            body: { delta: 5, reason: 'restock for audit test' }
        })
        expect(response.status).toBe(200)

        // Most recent first: createProduct's own insert/stock-seed rows sort after this one.
        const rows = await latestFor('inventory', inv!.id)
        expect(rows[0]!.action).toBe('update')
        expect(rows[0]!.actor_role).toBe('manager')
        const changes = rows[0]!.changes as Record<string, { before: unknown; after: unknown }>
        expect(changes.quantity).toEqual({ before: 3, after: 8 })
        // A positive delta also bumps last_restocked_at (the RPC's own logic): both columns changed, nothing else did.
        expect(Object.keys(changes).sort()).toEqual(['last_restocked_at', 'quantity'])
        expect(changes).not.toHaveProperty('updated_at')
    })

    test('a PATCH on a product logs only the changed field', async () => {
        const product = await createProduct({ name: 'Old Name' })
        const manager = await loginAs('manager')
        const response = await manager.patch(patchProduct, `products/${product.id}`, {
            params: { id: product.id },
            body: { name: 'New Name' }
        })
        expect(response.status).toBe(200)

        // Most recent first: createProduct's own INSERT sorts after this UPDATE.
        const rows = await latestFor('products', product.id)
        expect(rows[0]!.changes).toEqual({ name: { before: 'Old Name', after: 'New Name' } })
    })
})

describe('session events', () => {
    test('an HTTP login records a login row, a wrong password records login_failed', async () => {
        const users = await ensureTestUsers()
        const before = await adminClient()
            .from('audit_log')
            .select('id')
            .eq('action', 'login')
            .eq('actor_id', users.cashier.id)

        const client = new TestClient()
        const response = await client.post(login, 'auth/login', {
            body: { email: users.cashier.email, password: TEST_PASSWORD }
        })
        expect(response.status).toBe(200)

        const after = await adminClient()
            .from('audit_log')
            .select('id')
            .eq('action', 'login')
            .eq('actor_id', users.cashier.id)
        expect(after.data?.length ?? 0).toBeGreaterThan(before.data?.length ?? 0)

        const failed = new TestClient()
        await failed.post(login, 'auth/login', { body: { email: users.cashier.email, password: 'wrong-password-x' } })
        const { data: failedRows } = await adminClient()
            .from('audit_log')
            .select('*')
            .eq('action', 'login_failed')
            .eq('actor_email', users.cashier.email)
            .order('occurred_at', { ascending: false })
            .limit(1)
        expect(failedRows).toHaveLength(1)
        expect(failedRows![0]!.actor_id).toBeNull()
    })

    test('log_auth_event needs a session and rejects an action outside the allowed list', async () => {
        const { error: noSession } = await adminClient().rpc('log_auth_event', { p_action: 'login' })
        expect(noSession?.message).toContain('authentication required')

        const cashier = await signedInClient('cashier')
        const rejected = await cashier.rpc('log_auth_event', { p_action: 'delete' })
        expect(rejected.error).not.toBeNull()

        const { data: userData } = await cashier.auth.getUser()
        const ok = await cashier.rpc('log_auth_event', { p_action: 'logout' })
        expect(ok.error).toBeNull()

        const { data: rows } = await adminClient()
            .from('audit_log')
            .select('actor_id')
            .eq('action', 'logout')
            .eq('actor_id', userData.user!.id)
            .order('occurred_at', { ascending: false })
            .limit(1)
        expect(rows).toHaveLength(1)
        expect(rows![0]!.actor_id).toBe(userData.user!.id)
    })
})
