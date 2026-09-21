import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'

interface FakeUser {
    id: string
    email: string
}
let authUser: FakeUser | null = null
let profile: unknown = null

const fakeClient = () => ({
    auth: {
        getUser: async () =>
            authUser
                ? { data: { user: authUser }, error: null }
                : { data: { user: null }, error: { message: 'no session' } }
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) })
})
void mock.module('@/lib/server/supabase', () => ({ createSupabaseServerClient: async () => fakeClient() }))

const { route, publicRoute, ok, created, noContent, paginated } = await import('./http')
const { AppError, notFound } = await import('./errors')

const signIn = (role: string, extra: Record<string, unknown> = {}) => {
    authUser = { id: 'u1', email: 'u@shop.com' }
    profile = { role, full_name: 'U', is_active: true, ...extra }
}
const request = (method = 'GET', init: RequestInit & { headers?: Record<string, string> } = {}) =>
    new Request('http://localhost:3000/api/v1/x?page=2', { method, ...init })
const json = (body: unknown) => ({
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', host: 'localhost:3000' }
})

beforeEach(() => {
    authUser = null
    profile = null
})

describe('authentication and roles', () => {
    const handler = route({ role: 'manager', handler: async ({ user }) => ok({ role: user.role }) })

    test('401 without a session', async () => {
        const res = await handler(request())
        expect(res.status).toBe(401)
        expect((await res.json()).error.code).toBe('unauthorized')
    })
    test('403 when the role is below the minimum', async () => {
        signIn('cashier')
        const res = await handler(request())
        expect(res.status).toBe(403)
        expect((await res.json()).error.code).toBe('forbidden')
    })
    test('roles are hierarchical', async () => {
        signIn('manager')
        expect((await handler(request())).status).toBe(200)
        signIn('admin')
        expect(await (await handler(request())).json()).toEqual({ data: { role: 'admin' } })
    })
    test('an inactive user is treated as unauthenticated', async () => {
        signIn('admin', { is_active: false })
        expect((await handler(request())).status).toBe(401)
    })
    test('a missing or malformed profile is treated as unauthenticated', async () => {
        signIn('admin')
        profile = null
        expect((await handler(request())).status).toBe(401)
        profile = { role: 'superuser', full_name: null, is_active: true }
        expect((await handler(request())).status).toBe(401)
    })
})

describe('input validation', () => {
    const handler = route({
        role: 'cashier',
        body: z.object({ name: z.string().min(1) }),
        query: z.object({ page: z.coerce.number() }),
        params: z.object({ id: z.uuid() }),
        handler: async ({ body, query, params }) => ok({ body, query, params })
    })
    const id = '11111111-1111-4111-8111-111111111111'
    const ctx = (value: string) => ({ params: Promise.resolve({ id: value }) })

    test('passes parsed body, query and params to the handler', async () => {
        signIn('cashier')
        const res = await handler(request('POST', json({ name: 'a', extra: 1 })), ctx(id))
        expect(await res.json()).toEqual({ data: { body: { name: 'a' }, query: { page: 2 }, params: { id } } })
    })
    test('422 with per-field details on invalid input', async () => {
        signIn('cashier')
        const res = await handler(request('POST', json({ name: '' })), ctx('not-a-uuid'))
        const body = await res.json()
        expect(res.status).toBe(422)
        expect(body.error.code).toBe('validation_failed')
        expect(body.error.details).toBeArray()
    })
    test('reports the failing body path', async () => {
        signIn('cashier')
        const res = await handler(request('POST', json({ name: '' })), ctx(id))
        expect((await res.json()).error.details).toEqual([{ path: 'name', message: expect.any(String) }])
    })
    test('400 on malformed JSON', async () => {
        signIn('cashier')
        const res = await handler(request('POST', { body: '{nope', headers: { host: 'localhost:3000' } }), ctx(id))
        expect(res.status).toBe(400)
        expect((await res.json()).error.code).toBe('bad_request')
    })
    test('validation runs after authentication (401 before 422)', async () => {
        const res = await handler(request('POST', json({ name: '' })), ctx('bad'))
        expect(res.status).toBe(401)
    })
})

describe('CSRF / same-origin check', () => {
    const handler = route({ role: 'cashier', handler: async () => ok(true) })
    beforeEach(() => signIn('cashier'))

    test('rejects a write from another origin', async () => {
        const res = await handler(
            request('POST', { headers: { origin: 'https://evil.example', host: 'localhost:3000' } })
        )
        expect(res.status).toBe(403)
    })
    test('rejects a malformed Origin', async () => {
        const res = await handler(request('DELETE', { headers: { origin: 'null', host: 'localhost:3000' } }))
        expect(res.status).toBe(403)
    })
    test('accepts a write from the same origin', async () => {
        const res = await handler(
            request('POST', { headers: { origin: 'http://localhost:3000', host: 'localhost:3000' } })
        )
        expect(res.status).toBe(200)
    })
    test('honors x-forwarded-host behind a proxy', async () => {
        const res = await handler(
            request('PATCH', {
                headers: { origin: 'https://shop.example', host: 'internal:3000', 'x-forwarded-host': 'shop.example' }
            })
        )
        expect(res.status).toBe(200)
    })
    test('allows writes without Origin (non-browser clients) and ignores Origin on reads', async () => {
        expect((await handler(request('POST'))).status).toBe(200)
        expect((await handler(request('GET', { headers: { origin: 'https://evil.example' } }))).status).toBe(200)
    })
})

describe('error mapping and response envelope', () => {
    beforeEach(() => signIn('admin'))

    test('AppError keeps its status and code', async () => {
        const res = await route({
            role: 'cashier',
            handler: async () => {
                throw notFound('No such order')
            }
        })(request())
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No such order' } })
    })
    test('database errors are mapped without raw messages', async () => {
        const res = await route({
            role: 'cashier',
            handler: async () => {
                throw { code: '23505', message: 'duplicate key value violates unique constraint "products_sku_key"' }
            }
        })(request())
        const text = await res.text()
        expect(res.status).toBe(409)
        expect(text).not.toContain('products_sku_key')
    })
    test('RPC business errors (P0001) reach the client as 422', async () => {
        const res = await route({
            role: 'cashier',
            handler: async () => {
                throw { code: 'P0001', message: 'insufficient stock for product abc' }
            }
        })(request())
        expect(res.status).toBe(422)
        expect((await res.json()).error.message).toBe('insufficient stock for product abc')
    })
    test('unexpected errors are 500 with a generic message', async () => {
        const original = console.error
        console.error = () => {}
        try {
            const res = await route({
                role: 'cashier',
                handler: async () => {
                    throw new Error('connection string postgres://user:pw@host')
                }
            })(request())
            const text = await res.text()
            expect(res.status).toBe(500)
            expect(text).not.toContain('postgres://')
            expect(JSON.parse(text).error.code).toBe('internal_error')
        } finally {
            console.error = original
        }
    })
    test('status helpers, no-store and pagination envelope', async () => {
        const make = (result: ReturnType<typeof ok>) =>
            route({ role: 'cashier', handler: async () => result })(request())
        const res201 = await make(created({ id: 1 }))
        expect(res201.status).toBe(201)
        expect(res201.headers.get('cache-control')).toBe('no-store')
        const res204 = await make(noContent())
        expect(res204.status).toBe(204)
        expect(await res204.text()).toBe('')
        const list = await (await make(paginated([1, 2], { page: 1, pageSize: 25, total: 2 }))).json()
        expect(list).toEqual({ data: [1, 2], page: 1, pageSize: 25, total: 2 })
    })
    test('handlers may return a raw Response (e.g. redirects, CSV)', async () => {
        const res = await route({ role: 'cashier', handler: async () => new Response('a,b', { status: 200 }) })(
            request()
        )
        expect(await res.text()).toBe('a,b')
    })
    test('AppError is exported for services', () => {
        expect(new AppError('conflict', 'x').status).toBe(409)
    })
})

describe('publicRoute', () => {
    test('runs without a session and validates input', async () => {
        const handler = publicRoute({
            body: z.object({ email: z.email() }),
            handler: async ({ user, body }) => ok({ user, email: body.email })
        })
        const res = await handler(request('POST', json({ email: 'a@b.com' })))
        expect(await res.json()).toEqual({ data: { user: null, email: 'a@b.com' } })
        expect((await handler(request('POST', json({ email: 'nope' })))).status).toBe(422)
    })
    test('also applies the same-origin check', async () => {
        const handler = publicRoute({ handler: async () => ok(true) })
        const res = await handler(
            request('POST', { headers: { origin: 'https://evil.example', host: 'localhost:3000' } })
        )
        expect(res.status).toBe(403)
    })
})
