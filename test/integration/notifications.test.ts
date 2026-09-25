import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import {
    adminClient,
    createProduct,
    ensureTestUsers,
    pinStoreCurrency,
    signedInClient,
    uniq,
    type Db,
    type TestUsers
} from '../helpers/integration'

/**
 * Phase F staff alerts. Written against migrations D/E/F applied in order; do not run on a DB that only has A–C
 * (orders.due_date / reminder_enabled come from phase E).
 */

let users: TestUsers
let cashier: Db
let adminUser: Db
const service = () => adminClient() as unknown as UntypedDb

type UntypedDb = {
    from: (table: string) => {
        select: (columns?: string) => LooseQ
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => PromiseLike<DbRes>
        update: (row: Record<string, unknown>) => LooseQ
        delete: () => LooseQ
    }
    rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<DbRes>
}

type DbRes = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }
type LooseQ = PromiseLike<DbRes> & {
    eq: (c: string, v: unknown) => LooseQ
    is: (c: string, v: unknown) => LooseQ
    in: (c: string, v: unknown[]) => LooseQ
    order: (c: string, o?: object) => LooseQ
    limit: (n: number) => LooseQ
    maybeSingle: () => PromiseLike<DbRes>
    single: () => PromiseLike<DbRes>
}

let restoreCurrency: () => Promise<void>

beforeAll(async () => {
    users = await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
    ;[cashier, adminUser] = await Promise.all([signedInClient('cashier'), signedInClient('admin')])
})

afterAll(async () => {
    await restoreCurrency()
})

async function inventoryId(productId: string): Promise<string> {
    const { data, error } = await service()
        .from('inventory')
        .select('id')
        .eq('product_id', productId)
        .is('variant_id', null)
        .single()
    if (error || !data || typeof data !== 'object' || !('id' in data)) throw error ?? new Error('no inventory')
    return (data as { id: string }).id
}

async function outboxKinds(
    productId?: string
): Promise<Array<{ id: number; kind: string; payload: Record<string, unknown> }>> {
    const { data, error } = await service().from('notification_outbox').select('id, kind, payload').order('id')
    if (error) throw error
    const rows = (data as Array<{ id: number; kind: string; payload: Record<string, unknown> }> | null) ?? []
    if (!productId) return rows
    return rows.filter(r => r.kind === 'low_stock' && r.payload.product_id === productId)
}

async function clearOutbox(): Promise<void> {
    // service_role bypasses RLS; wipe pending/processed rows for isolation between cases.
    const { data } = await service().from('notification_outbox').select('id')
    const ids = ((data as Array<{ id: number }> | null) ?? []).map(r => r.id)
    for (const id of ids) {
        await service().from('notification_outbox').delete().eq('id', id)
    }
}

describe('low_stock outbox', () => {
    test('crossing the threshold enqueues once; staying low does not; restock then cross again does', async () => {
        await clearOutbox()
        const product = await createProduct({ stock: 5, threshold: 2, selling_price: 10, tax_rate: 0 })
        const inv = await inventoryId(product.id)
        await service().from('stock_alert_state').delete().eq('inventory_id', inv)
        await clearOutbox()

        // 5 → 2: crosses into low
        const sale1 = await cashier.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 3 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        expect(sale1.error).toBeNull()
        expect(await outboxKinds(product.id)).toHaveLength(1)

        // still low: no second row
        const sale2 = await cashier.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 1 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        expect(sale2.error).toBeNull()
        expect(await outboxKinds(product.id)).toHaveLength(1)

        // restock above threshold
        const { error: restockError } = await adminUser.rpc('adjust_inventory', {
            p_inventory_id: inv,
            p_delta: 10,
            p_reason: 'test restock'
        })
        expect(restockError).toBeNull()
        expect(await outboxKinds(product.id)).toHaveLength(1)

        // cross again
        const sale3 = await cashier.rpc('create_sale', {
            p_customer_id: null as unknown as string,
            p_items: [{ product_id: product.id, quantity: 10 }],
            p_payment_method: 'cash',
            p_discount: 0
        })
        expect(sale3.error).toBeNull()
        expect(await outboxKinds(product.id)).toHaveLength(2)
    })
})

describe('_claim_outbox', () => {
    test('two concurrent claims do not return the same id', async () => {
        await clearOutbox()
        const inserts = Array.from({ length: 10 }, (_, i) => ({
            kind: 'low_stock',
            payload: { inventory_id: crypto.randomUUID(), product_id: crypto.randomUUID(), quantity: i, threshold: 1 }
        }))
        const { error } = await service().from('notification_outbox').insert(inserts)
        expect(error).toBeNull()

        const [a, b] = await Promise.all([
            service().rpc('_claim_outbox', { p_limit: 50 }),
            service().rpc('_claim_outbox', { p_limit: 50 })
        ])
        expect(a.error).toBeNull()
        expect(b.error).toBeNull()
        const idsA = ((a.data as Array<{ id: number }> | null) ?? []).map(r => r.id)
        const idsB = ((b.data as Array<{ id: number }> | null) ?? []).map(r => r.id)
        const overlap = idsA.filter(id => idsB.includes(id))
        expect(overlap).toEqual([])
    })

    // D2 (F2): see docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md
    test('a row claimed more than 10 minutes ago is reclaimed instead of stuck forever', async () => {
        await clearOutbox()
        const productId = crypto.randomUUID()
        const insertError = await service()
            .from('notification_outbox')
            .insert({
                kind: 'low_stock',
                payload: { inventory_id: crypto.randomUUID(), product_id: productId, quantity: 0, threshold: 1 }
            })
        expect(insertError.error).toBeNull()
        const inserted = await service().from('notification_outbox').select('id').eq('kind', 'low_stock').single()
        expect(inserted.error).toBeNull()
        const id = (inserted.data as { id: number }).id

        // Simulate a dispatch that claimed the row and then crashed before marking success/failure.
        const staleClaim = await service()
            .from('notification_outbox')
            .update({ claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() })
            .eq('id', id)
        expect(staleClaim.error).toBeNull()

        const tooSoon = await service().rpc('_claim_outbox', { p_limit: 50 })
        // A claim from 11 minutes ago is stale (> 10 min) and must be reclaimed.
        expect(tooSoon.error).toBeNull()
        expect(((tooSoon.data as Array<{ id: number }> | null) ?? []).map(r => r.id)).toContain(id)

        // A fresh claim (just made, e.g. by the call above) must NOT be immediately reclaimed by another caller.
        const immediateRetry = await service().rpc('_claim_outbox', { p_limit: 50 })
        expect(immediateRetry.error).toBeNull()
        expect(((immediateRetry.data as Array<{ id: number }> | null) ?? []).map(r => r.id)).not.toContain(id)
    })
})

describe('receivable_due outbox', () => {
    test('a due receivable with reminder enqueues once per store-local day', async () => {
        await clearOutbox()
        const orderId = crypto.randomUUID()
        const { error: orderError } = await service()
            .from('orders')
            .insert({
                id: orderId,
                order_number: uniq('ORD'),
                status: 'pending',
                subtotal: 10,
                tax: 0,
                discount: 0,
                total: 10,
                due_date: '2000-01-01',
                reminder_enabled: true,
                created_by: users.admin.id
            })
        expect(orderError).toBeNull()

        const first = await service().rpc('_enqueue_due_receivables')
        expect(first.error).toBeNull()
        const { data: rows1 } = await service().from('notification_outbox').select('id').eq('kind', 'receivable_due')
        const count1 = ((rows1 as unknown[] | null) ?? []).length
        expect(count1).toBeGreaterThanOrEqual(1)

        const second = await service().rpc('_enqueue_due_receivables')
        expect(second.error).toBeNull()
        const { data: rows2 } = await service().from('notification_outbox').select('id').eq('kind', 'receivable_due')
        expect(((rows2 as unknown[] | null) ?? []).length).toBe(count1)
    })
})

describe('push_subscriptions RLS', () => {
    test('a user cannot read or delete another user’s subscription', async () => {
        const endpoint = `https://push.example.test/${uniq('ep')}`
        const { error: insertError } = await (adminUser as unknown as UntypedDb).from('push_subscriptions').insert({
            user_id: users.admin.id,
            endpoint,
            p256dh: 'p256dh-test',
            auth: 'auth-test'
        })
        expect(insertError).toBeNull()

        const { data: seen } = await (cashier as unknown as UntypedDb)
            .from('push_subscriptions')
            .select('id')
            .eq('endpoint', endpoint)
        expect(seen ?? []).toEqual([])

        const { error: delError, count } = await (cashier as unknown as UntypedDb)
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', endpoint)
        expect(delError).toBeNull()
        // RLS: 0 rows affected
        void count
        const { data: still } = await service().from('push_subscriptions').select('id').eq('endpoint', endpoint)
        expect(((still as unknown[] | null) ?? []).length).toBe(1)

        await service().from('push_subscriptions').delete().eq('endpoint', endpoint)
    })
})

describe('dispatchOutbox', () => {
    test('sends one summary per recipient; HTTP 410 deletes the subscription', async () => {
        const emails: string[] = []
        const pushes: string[] = []

        void mock.module('resend', () => ({
            Resend: class {
                emails = {
                    send: async ({ to }: { to: string }) => {
                        emails.push(to)
                        return { data: { id: 'msg' }, error: null }
                    }
                }
            }
        }))

        void mock.module('web-push', () => ({
            WebPushError: class extends Error {
                statusCode: number
                constructor(message: string, statusCode: number) {
                    super(message)
                    this.statusCode = statusCode
                }
            },
            default: {
                setVapidDetails: () => undefined,
                sendNotification: async (sub: { endpoint: string }) => {
                    pushes.push(sub.endpoint)
                    if (sub.endpoint.includes('gone')) {
                        const err = new Error('Gone') as Error & { statusCode: number }
                        err.statusCode = 410
                        throw err
                    }
                    return { statusCode: 201 }
                }
            }
        }))

        process.env.RESEND_API_KEY = 're_test'
        process.env.EMAIL_FROM = 'Barstock <alerts@example.com>'
        process.env.VAPID_PUBLIC_KEY = 'vapid-pub'
        process.env.VAPID_PRIVATE_KEY = 'vapid-priv'
        process.env.VAPID_SUBJECT = 'mailto:ops@example.com'

        await clearOutbox()
        await service()
            .from('notification_outbox')
            .insert({
                kind: 'low_stock',
                payload: {
                    inventory_id: crypto.randomUUID(),
                    product_id: crypto.randomUUID(),
                    quantity: 0,
                    threshold: 1
                }
            })

        const goneEndpoint = `https://fcm.googleapis.com/fcm/send/${uniq('gone')}`
        const okEndpoint = `https://fcm.googleapis.com/fcm/send/${uniq('ok')}`
        await service()
            .from('push_subscriptions')
            .insert([
                {
                    user_id: users.admin.id,
                    endpoint: goneEndpoint,
                    p256dh: 'p',
                    auth: 'a'
                },
                {
                    user_id: users.admin.id,
                    endpoint: okEndpoint,
                    p256dh: 'p',
                    auth: 'a'
                }
            ])

        // Fresh import after mocks
        const { dispatchOutbox } = await import('@/lib/server/services/notifications')
        await dispatchOutbox()

        expect(emails.length).toBeGreaterThanOrEqual(1)
        expect(pushes).toContain(okEndpoint)
        expect(pushes).toContain(goneEndpoint)

        const { data: remaining } = await service()
            .from('push_subscriptions')
            .select('endpoint')
            .in('endpoint', [goneEndpoint, okEndpoint])
        const endpoints = ((remaining as Array<{ endpoint: string }> | null) ?? []).map(r => r.endpoint)
        expect(endpoints).toContain(okEndpoint)
        expect(endpoints).not.toContain(goneEndpoint)
    })
})

describe('notification preference and push HTTP routes', () => {
    test('PATCH prefs and POST/DELETE push subscription load validation schemas', async () => {
        const { PATCH: patchPrefs } = await import('@/app/api/v1/me/notifications/route')
        const { POST: postPush, DELETE: deletePush } = await import('@/app/api/v1/me/push-subscriptions/route')
        const { GET: getKey } = await import('@/app/api/v1/me/push-key/route')
        const { loginAs, dataOf } = await import('../helpers/http')

        const http = await loginAs('cashier')
        const prefs = await http.patch(patchPrefs, 'me/notifications', {
            body: { notify_email: false, notify_push: true }
        })
        expect(prefs.status).toBe(200)
        expect(dataOf<{ notify_email: boolean; notify_push: boolean }>(prefs)).toEqual({
            notify_email: false,
            notify_push: true
        })

        const endpoint = `https://fcm.googleapis.com/fcm/send/${uniq('http')}`
        const created = await http.post(postPush, 'me/push-subscriptions', {
            body: { endpoint, p256dh: 'pk', auth: 'ak', user_agent: 'test' }
        })
        expect(created.status).toBe(200)

        const removed = await http.delete(deletePush, 'me/push-subscriptions', {
            body: { endpoint }
        })
        expect(removed.status).toBe(200)

        const key = await http.get(getKey, 'me/push-key')
        expect([200, 503]).toContain(key.status)
    })

    // S2 (SSRF allowlist): see docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md
    test('a private-network or non-allowlisted push endpoint is rejected with 400', async () => {
        const { POST: postPush } = await import('@/app/api/v1/me/push-subscriptions/route')
        const { loginAs } = await import('../helpers/http')
        const http = await loginAs('cashier')

        // Rejected by the pushSubscriptionSchema allowlist refine — this codebase's convention for a zod
        // validation failure is 422, not 400 (see auth.test.ts / currency.test.ts).
        const privateIp = await http.post(postPush, 'me/push-subscriptions', {
            body: { endpoint: 'http://10.0.0.1/push', p256dh: 'pk', auth: 'ak' }
        })
        expect(privateIp.status).toBe(422)

        const untrustedHost = await http.post(postPush, 'me/push-subscriptions', {
            body: { endpoint: 'https://evil.com/push', p256dh: 'pk', auth: 'ak' }
        })
        expect(untrustedHost.status).toBe(422)
    })

    // U5-adjacent: deleting a subscription must work even for a host the allowlist no longer covers.
    test('deleting a push subscription does not apply the endpoint allowlist', async () => {
        const { DELETE: deletePush } = await import('@/app/api/v1/me/push-subscriptions/route')
        const { loginAs } = await import('../helpers/http')
        const http = await loginAs('cashier')

        const removed = await http.delete(deletePush, 'me/push-subscriptions', {
            body: { endpoint: 'https://evil.com/push' }
        })
        expect(removed.status).toBe(200)
    })
})
