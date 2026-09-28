import { beforeAll, describe, expect, test } from 'bun:test'
import { POST as discardLog } from '@/app/api/v1/outbox/discard-log/route'
import { POST as createSale } from '@/app/api/v1/sales/route'
import { adminClient, createProduct, ensureTestUsers } from '../helpers/integration'
import { errorOf, loginAs, type TestClient } from '../helpers/http'

interface AuditRow {
    actor_id: string | null
    action: string
    entity: string
    entity_id: string | null
    changes: Record<string, unknown> | null
}

const latestDiscard = async (provisionalNumber: string): Promise<AuditRow | null> => {
    const { data, error } = await adminClient()
        .from('audit_log')
        .select('*')
        .eq('entity', 'outbox')
        .eq('entity_id', provisionalNumber)
        .order('occurred_at', { ascending: false })
        .limit(1)
    if (error) throw error
    return (data as AuditRow[])[0] ?? null
}

const provisional = () => `OFF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

const validBody = (overrides: Record<string, unknown> = {}) => ({
    client_ref: crypto.randomUUID(),
    owner_user_id: crypto.randomUUID(),
    provisional_number: provisional(),
    expected_total: 42.5,
    payment_method: 'cash',
    reason: 'customer walked away',
    ...overrides
})

let cashier: TestClient
let manager: TestClient

beforeAll(async () => {
    await ensureTestUsers()
    ;[cashier, manager] = await Promise.all([loginAs('cashier'), loginAs('manager')])
})

describe('POST /api/v1/outbox/discard-log', () => {
    test('a cashier is refused: manager+ only, at the API and the RPC', async () => {
        const response = await cashier.post(discardLog, 'outbox/discard-log', { body: validBody() })
        expect(response.status).toBe(403)
    })

    test('a manager logs a discard: writes an audit_log row with the claimed detail', async () => {
        const body = validBody()
        const response = await manager.post(discardLog, 'outbox/discard-log', { body })
        expect(response.status).toBe(204)

        const row = await latestDiscard(body.provisional_number)
        expect(row).toMatchObject({
            action: 'discard',
            entity: 'outbox',
            entity_id: body.provisional_number,
            changes: {
                client_ref: body.client_ref,
                owner_user_id: body.owner_user_id,
                provisional_number: body.provisional_number,
                expected_total: body.expected_total,
                payment_method: body.payment_method,
                reason: body.reason
            }
        })
    })

    test('rejects a client_ref that already reached the server: refuses to log a false "never arrived" claim', async () => {
        const product = await createProduct({ selling_price: 10, tax_rate: 0, stock: 5 })
        const key = crypto.randomUUID()
        const sale = await cashier.post(createSale, 'sales', {
            body: { payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] },
            headers: { 'Idempotency-Key': key }
        })
        expect(sale.status).toBe(201)

        const response = await manager.post(discardLog, 'outbox/discard-log', {
            body: validBody({ client_ref: key })
        })
        expect(response.status).toBe(409)
        expect(errorOf(response).message).toMatch(/already reached the server/)

        // No audit row for a discard that never actually happened.
        const row = await adminClient()
            .from('audit_log')
            .select('id')
            .eq('entity', 'outbox')
            .eq('changes->>client_ref', key)
        expect(row.data).toEqual([])
    })

    test('rejects a bogus payment_method (not the real enum)', async () => {
        const response = await manager.post(discardLog, 'outbox/discard-log', {
            body: validBody({ payment_method: 'bitcoin' })
        })
        expect(response.status).toBe(422)
    })

    test('rejects a malformed provisional_number', async () => {
        const response = await manager.post(discardLog, 'outbox/discard-log', {
            body: validBody({ provisional_number: 'not-the-right-shape' })
        })
        expect(response.status).toBe(422)
    })

    test('rejects a reason under 3 characters', async () => {
        const response = await manager.post(discardLog, 'outbox/discard-log', { body: validBody({ reason: 'ok' }) })
        expect(response.status).toBe(422)
    })
})
