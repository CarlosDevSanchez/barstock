import { beforeAll, describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { adminClient, ensureTestUsers, TEST_PASSWORD, uniq } from '../helpers/integration'
import { loginAs, TestClient } from '../helpers/http'

// The proxy reads the session from the request cookies, so these tests replay the cookies a real login produced.
beforeAll(async () => {
    await ensureTestUsers()
})

const ORIGIN = 'http://localhost:3000'
const cookieHeader = (client: TestClient) => [...client.jar].map(([name, value]) => `${name}=${value}`).join('; ')
const visit = (path: string, client?: TestClient) =>
    proxy(new NextRequest(`${ORIGIN}${path}`, { headers: client ? { cookie: cookieHeader(client) } : {} }))
const redirectPath = (response: Response) => {
    const location = response.headers.get('location')
    return location ? new URL(location).pathname + new URL(location).search : null
}
const passesThrough = (response: Response) => response.headers.get('x-middleware-next') === '1'

describe('signed out', () => {
    test('pages go to /login and remember where the visitor was going', async () => {
        const response = await visit('/pos?table=4')
        expect(response.status).toBe(307)
        expect(redirectPath(response)).toBe('/login?next=%2Fpos%3Ftable%3D4')
        expect(redirectPath(await visit('/'))).toBe('/login')
    })

    test('the API answers 401 JSON instead of redirecting', async () => {
        const response = await visit('/api/v1/products')
        expect(response.status).toBe(401)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({ error: { code: 'unauthorized', message: 'Authentication required' } })
    })

    test('the public pages and the auth endpoints are reachable', async () => {
        for (const path of [
            '/login',
            '/forgot-password',
            '/reset-password',
            '/auth/confirm?token_hash=x&type=recovery',
            '/api/v1/auth/login'
        ]) {
            expect(passesThrough(await visit(path))).toBe(true)
        }
    })
})

describe('signed in', () => {
    test('a signed-in user is taken away from /login, but may open /reset-password (invitation links)', async () => {
        const cashier = await loginAs('cashier')
        expect(redirectPath(await visit('/login', cashier))).toBe('/dashboard')
        expect(redirectPath(await visit('/forgot-password', cashier))).toBe('/dashboard')
        expect(passesThrough(await visit('/reset-password', cashier))).toBe(true)
        expect(passesThrough(await visit('/auth/confirm?token_hash=x&type=invite', cashier))).toBe(true)
    })

    test('role guards: each section needs its minimum role', async () => {
        const [cashier, manager, admin] = await Promise.all([loginAs('cashier'), loginAs('manager'), loginAs('admin')])
        const expectations: Array<[string, boolean, boolean, boolean]> = [
            // path,          cashier, manager, admin
            ['/dashboard', true, true, true],
            ['/pos', true, true, true],
            ['/reports', false, true, true],
            ['/suppliers', false, true, true],
            ['/settings', false, false, true],
            ['/users', false, false, true],
            ['/settings/anything', false, false, true]
        ]
        for (const [path, forCashier, forManager, forAdmin] of expectations) {
            for (const [client, allowed] of [
                [cashier, forCashier],
                [manager, forManager],
                [admin, forAdmin]
            ] as const) {
                const response = await visit(path, client)
                if (allowed) expect(passesThrough(response)).toBe(true)
                else expect(redirectPath(response)).toBe('/dashboard')
            }
        }
    })

    test('a section whose name merely starts like a guarded one is not guarded', async () => {
        const cashier = await loginAs('cashier')
        expect(passesThrough(await visit('/settingsx', cashier))).toBe(true)
    })

    test('a disabled account with a still-valid session is signed out, not bounced in a redirect loop', async () => {
        const created = await adminClient().auth.admin.createUser({
            email: `${uniq('disabled')}@barstock.test`,
            password: TEST_PASSWORD,
            email_confirm: true,
            app_metadata: { role: 'cashier' }
        })
        const id = created.data.user?.id ?? ''
        try {
            const client = new TestClient()
            const { POST } = await import('@/app/api/v1/auth/login/route')
            expect(
                (
                    await client.post(POST, 'auth/login', {
                        body: { email: created.data.user?.email, password: TEST_PASSWORD }
                    })
                ).status
            ).toBe(200)
            expect(redirectPath(await visit('/login', client))).toBe('/dashboard') // active: normal behaviour

            await adminClient().from('profiles').update({ is_active: false }).eq('id', id)

            // /login must NOT send them to /dashboard (whose layout sends them back here): it ends the session instead.
            const login = await visit('/login', client)
            expect(passesThrough(login)).toBe(true)
            expect(login.headers.get('set-cookie') ?? '').toMatch(/sb-.*(Max-Age=0|expires=)/i)
            expect(login.headers.get('set-cookie') ?? '').toMatch(/HttpOnly/i)
            // The session is revoked server-side by that sign-out, so the next request is anonymous: /login, no loop.
            expect(redirectPath(await visit('/settings', client))).toMatch(/^\/login/)
        } finally {
            await adminClient().auth.admin.deleteUser(id)
        }
    })
})
