import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { adminClient, ensureTestUsers, pinStoreCurrency, uniq, type TestUsers } from '../helpers/integration'

/**
 * `dispatchOutbox` end-to-end, with resend/web-push mocked. Split out from notifications.test.ts and run as its
 * own bun process (see package.json `test:integration` and docs/05-guias/testing.md): `mock.module` is global to
 * the whole bun process, so keeping it here means it can never leak into any other integration test file.
 *
 * Also restores every env var it touches with try/finally: a previous version of this test set
 * RESEND_API_KEY/VAPID_* directly on process.env with no cleanup, which — because this file did NOT use to run
 * alone — could leave those vars set for whatever integration test happened to run after it in the same process.
 */

let users: TestUsers
const service = () => adminClient() as unknown as UntypedDb

type UntypedDb = {
    from: (table: string) => {
        select: (columns?: string) => LooseQ
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => PromiseLike<DbRes>
        delete: () => LooseQ
    }
    rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<DbRes>
}

type DbRes = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }
type LooseQ = PromiseLike<DbRes> & {
    eq: (c: string, v: unknown) => LooseQ
    in: (c: string, v: unknown[]) => LooseQ
}

let restoreCurrency: () => Promise<void>

beforeAll(async () => {
    users = await ensureTestUsers()
    restoreCurrency = await pinStoreCurrency('USD')
})

afterAll(async () => {
    await restoreCurrency()
})

async function clearOutbox(): Promise<void> {
    const { data } = await service().from('notification_outbox').select('id')
    const ids = ((data as Array<{ id: number }> | null) ?? []).map(r => r.id)
    for (const id of ids) await service().from('notification_outbox').delete().eq('id', id)
}

/** Sets the given env vars for the duration of `fn`, then restores their previous values (or deletes them). */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const previous = new Map(Object.keys(vars).map(key => [key, process.env[key]]))
    for (const [key, value] of Object.entries(vars)) process.env[key] = value
    try {
        return await fn()
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

const NOTIFY_ENV = {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Barstock <alerts@example.com>',
    VAPID_PUBLIC_KEY: 'vapid-pub',
    VAPID_PRIVATE_KEY: 'vapid-priv',
    VAPID_SUBJECT: 'mailto:ops@example.com'
}

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

        await withEnv(NOTIFY_ENV, async () => {
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
                    { user_id: users.admin.id, endpoint: goneEndpoint, p256dh: 'p', auth: 'a' },
                    { user_id: users.admin.id, endpoint: okEndpoint, p256dh: 'p', auth: 'a' }
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

    // F3: docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md. The first recipient dispatchOutbox tries
    // fails once; a second dispatchOutbox call (simulating the next cron tick) must reach ONLY that recipient
    // again, not re-send to whoever already succeeded on the first pass.
    test('a retry only re-sends to the recipient who previously failed, not to one who already succeeded', async () => {
        const { data: activeAdmins } = await service().from('profiles').select('id, email').eq('role', 'admin')
        const admins = ((activeAdmins as Array<{ id: string; email: string }> | null) ?? []).map(a => a.email)
        expect(admins.length).toBeGreaterThanOrEqual(1)

        const deliveries: string[] = []
        let firstAttemptDone = false
        let failedOnce: string | null = null

        void mock.module('resend', () => ({
            Resend: class {
                emails = {
                    send: async ({ to }: { to: string }) => {
                        // Fail exactly the first recipient seen, exactly once, so the test is deterministic
                        // regardless of how many admin fixtures exist.
                        if (!firstAttemptDone && failedOnce === null) {
                            failedOnce = to
                            return { data: null, error: { message: 'simulated failure' } }
                        }
                        deliveries.push(to)
                        return { data: { id: 'msg' }, error: null }
                    }
                }
            }
        }))
        void mock.module('web-push', () => ({
            WebPushError: class extends Error {},
            default: { setVapidDetails: () => undefined, sendNotification: async () => ({ statusCode: 201 }) }
        }))

        await withEnv({ RESEND_API_KEY: NOTIFY_ENV.RESEND_API_KEY, EMAIL_FROM: NOTIFY_ENV.EMAIL_FROM }, async () => {
            await clearOutbox()
            await service()
                .from('notification_outbox')
                .insert({ kind: 'low_stock', payload: { inventory_id: crypto.randomUUID(), quantity: 0 } })

            const { dispatchOutbox } = await import('@/lib/server/services/notifications')
            await dispatchOutbox()
            firstAttemptDone = true

            // Round 1: everyone except `failedOnce` succeeded.
            expect(deliveries.length).toBe(admins.length - 1)
            expect(failedOnce).not.toBeNull()
            expect(deliveries).not.toContain(failedOnce)

            await dispatchOutbox()

            // Round 2: only the previously-failed recipient gets a NEW delivery — the others are not re-sent.
            expect(deliveries.length).toBe(admins.length)
            expect(deliveries).toContain(failedOnce as string)
            // Each admin appears exactly once across both rounds combined.
            const counts = new Map<string, number>()
            for (const to of deliveries) counts.set(to, (counts.get(to) ?? 0) + 1)
            for (const email of admins) expect(counts.get(email)).toBe(1)
        })
    })

    // D4: docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md
    test('with no channel configured, dispatchOutbox does not claim any row', async () => {
        await clearOutbox()
        await service()
            .from('notification_outbox')
            .insert({ kind: 'low_stock', payload: { inventory_id: crypto.randomUUID(), quantity: 0 } })

        await withEnv(
            {
                RESEND_API_KEY: '',
                EMAIL_FROM: '',
                VAPID_PUBLIC_KEY: '',
                VAPID_PRIVATE_KEY: '',
                VAPID_SUBJECT: ''
            },
            async () => {
                const { dispatchOutbox } = await import('@/lib/server/services/notifications')
                await dispatchOutbox()
            }
        )

        const { data } = await service().from('notification_outbox').select('id')
        const rows = (data as Array<{ id: number }> | null) ?? []
        expect(rows.length).toBeGreaterThanOrEqual(1)
        const { data: claimed } = await service().rpc('_claim_outbox', { p_limit: 50 })
        // Rows were never claimed (attempts never incremented, claimed_at never set): a plain claim now succeeds.
        expect(((claimed as unknown[] | null) ?? []).length).toBeGreaterThanOrEqual(1)
    })
})
