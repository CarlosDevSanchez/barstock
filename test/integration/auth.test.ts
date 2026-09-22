import { beforeAll, describe, expect, test } from 'bun:test'
import { GET as confirm } from '@/app/auth/confirm/route'
import { POST as forgot } from '@/app/api/v1/auth/password/forgot/route'
import { POST as login } from '@/app/api/v1/auth/login/route'
import { POST as logout } from '@/app/api/v1/auth/logout/route'
import { POST as resetPassword } from '@/app/api/v1/auth/password/reset/route'
import { GET as me } from '@/app/api/v1/me/route'
import { POST as invite } from '@/app/api/v1/users/invite/route'
import { confirmLinkIn, ensureTestUsers, TEST_PASSWORD, uniq, waitForEmail } from '../helpers/integration'
import { dataOf, errorOf, loginAs, TestClient } from '../helpers/http'

beforeAll(async () => {
    await ensureTestUsers()
})

describe('login / me / logout', () => {
    test('signs in with the role from the profile and sets a session', async () => {
        const client = await loginAs('manager')
        expect(client.jar.size).toBeGreaterThan(0)
        const response = await client.get(me, 'me')
        expect(response.status).toBe(200)
        expect(dataOf<{ email: string; role: string }>(response)).toMatchObject({
            email: 'manager@barstock.test',
            role: 'manager'
        })
    })

    test('a wrong password and an unknown email look exactly the same (no user enumeration)', async () => {
        const wrong = await new TestClient().post(login, 'auth/login', {
            body: { email: 'manager@barstock.test', password: 'not-the-password-1' }
        })
        const unknown = await new TestClient().post(login, 'auth/login', {
            body: { email: 'nobody@barstock.test', password: 'not-the-password-1' }
        })
        expect(wrong.status).toBe(401)
        expect(unknown.status).toBe(401)
        expect(wrong.text).toBe(unknown.text)
    })

    test('a disabled account is refused (403) and gets no session', async () => {
        const client = new TestClient()
        const response = await client.post(login, 'auth/login', {
            body: { email: 'inactive@barstock.test', password: TEST_PASSWORD }
        })
        expect(response.status).toBe(403)
        expect(errorOf(response).message).toBe('This account is disabled')
        expect((await client.get(me, 'me')).status).toBe(401)
    })

    test('the session cookies cannot be read by scripts and are not sent cross-site', async () => {
        const client = await loginAs('cashier')
        const session = [...client.cookieOptions].filter(([name]) => name.startsWith('sb-'))
        expect(session.length).toBeGreaterThan(0)
        for (const [, options] of session) {
            expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
        }
    })

    test('the login response never contains tokens', async () => {
        const client = new TestClient()
        const response = await client.post(login, 'auth/login', {
            body: { email: 'cashier@barstock.test', password: TEST_PASSWORD }
        })
        expect(response.text).not.toMatch(/access_token|refresh_token|eyJ/)
    })

    test('validates the body (422) and rejects malformed JSON (400)', async () => {
        const client = new TestClient()
        expect(
            (await client.post(login, 'auth/login', { body: { email: 'not-an-email', password: 'x' } })).status
        ).toBe(422)
        expect((await client.post(login, 'auth/login', { rawBody: '{oops' })).status).toBe(400)
    })

    test('me requires a session', async () => {
        const response = await new TestClient().get(me, 'me')
        expect(response.status).toBe(401)
        expect(errorOf(response).code).toBe('unauthorized')
    })

    test('logout ends the session', async () => {
        const client = await loginAs('cashier')
        expect((await client.get(me, 'me')).status).toBe(200)
        expect((await client.post(logout, 'auth/logout')).status).toBe(204)
        expect((await client.get(me, 'me')).status).toBe(401)
    })

    test('a cross-origin login attempt is rejected (CSRF)', async () => {
        const response = await new TestClient().post(login, 'auth/login', {
            body: { email: 'cashier@barstock.test', password: TEST_PASSWORD },
            origin: 'https://evil.example'
        })
        expect(response.status).toBe(403)
    })
})

describe('password reset', () => {
    test('forgot-password answers 204 for known and unknown emails alike', async () => {
        for (const email of ['cashier@barstock.test', `nobody-${uniq('x')}@barstock.test`]) {
            const response = await new TestClient().post(forgot, 'auth/password/forgot', { body: { email } })
            expect(response.status).toBe(204)
        }
    })

    test('setting a password needs a session and enforces the length', async () => {
        expect(
            (
                await new TestClient().post(resetPassword, 'auth/password/reset', {
                    body: { password: 'long-enough-password' }
                })
            ).status
        ).toBe(401)
        const client = await loginAs('cashier')
        expect((await client.post(resetPassword, 'auth/password/reset', { body: { password: 'short' } })).status).toBe(
            422
        )
    })

    test('recovery link: email -> confirm -> new password -> login, and the link works once', async () => {
        const admin = await import('../helpers/integration').then(m => m.adminClient())
        const email = `${uniq('recovery')}@barstock.test`
        const created = await admin.auth.admin.createUser({
            email,
            password: TEST_PASSWORD,
            email_confirm: true,
            app_metadata: { role: 'cashier' }
        })
        expect(created.error).toBeNull()

        const requester = new TestClient()
        expect((await requester.post(forgot, 'auth/password/forgot', { body: { email } })).status).toBe(204)
        const link = confirmLinkIn((await waitForEmail(email)).html)
        expect(link.searchParams.get('type')).toBe('recovery')

        const browser = new TestClient()
        const redirect = await browser.visit(confirm, link)
        expect(redirect.status).toBe(307)
        expect(new URL(redirect.headers.get('location') ?? '').pathname).toBe('/reset-password')

        const newPassword = 'a-brand-new-password-2'
        expect(
            (await browser.post(resetPassword, 'auth/password/reset', { body: { password: newPassword } })).status
        ).toBe(204)
        expect(
            (await new TestClient().post(login, 'auth/login', { body: { email, password: newPassword } })).status
        ).toBe(200)
        expect(
            (await new TestClient().post(login, 'auth/login', { body: { email, password: TEST_PASSWORD } })).status
        ).toBe(401)

        const reuse = await new TestClient().visit(confirm, link)
        expect(new URL(reuse.headers.get('location') ?? '').pathname).toBe('/login')
        expect(new URL(reuse.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_link')
    })

    test('/auth/confirm rejects garbage and unsupported types', async () => {
        const client = new TestClient()
        for (const path of [
            '/auth/confirm',
            '/auth/confirm?token_hash=abc&type=recovery',
            '/auth/confirm?token_hash=abc&type=magiclink'
        ]) {
            const response = await client.visit(confirm, new URL(path, 'http://localhost:3000'))
            expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login')
        }
    })
})

describe('invitation flow', () => {
    test('admin invites -> the invitee accepts by email and lands active with the invited role', async () => {
        const admin = await loginAs('admin')
        const email = `${uniq('invitee')}@barstock.test`
        const invited = await admin.post(invite, 'users/invite', {
            body: { email, full_name: 'New Manager', role: 'manager' }
        })
        expect(invited.status).toBe(201)
        expect(dataOf<{ role: string; is_active: boolean }>(invited)).toMatchObject({
            role: 'manager',
            is_active: true
        })

        const link = confirmLinkIn((await waitForEmail(email)).html)
        expect(link.searchParams.get('type')).toBe('invite')

        const browser = new TestClient()
        expect((await browser.visit(confirm, link)).status).toBe(307)
        expect(dataOf<{ role: string; fullName: string }>(await browser.get(me, 'me'))).toMatchObject({
            role: 'manager',
            fullName: 'New Manager'
        })
        expect(
            (await browser.post(resetPassword, 'auth/password/reset', { body: { password: 'the-invitee-password-3' } }))
                .status
        ).toBe(204)
        expect(
            (await new TestClient().post(login, 'auth/login', { body: { email, password: 'the-invitee-password-3' } }))
                .status
        ).toBe(200)
    })

    test('only an admin can invite', async () => {
        for (const role of ['manager', 'cashier'] as const) {
            const client = await loginAs(role)
            const response = await client.post(invite, 'users/invite', {
                body: { email: `${uniq('x')}@barstock.test`, role: 'admin' }
            })
            expect(response.status).toBe(403)
        }
        expect(
            (await new TestClient().post(invite, 'users/invite', { body: { email: 'a@b.co', role: 'cashier' } })).status
        ).toBe(401)
    })

    test('inviting an existing email is a 409, an invalid role a 422', async () => {
        const admin = await loginAs('admin')
        expect(
            (await admin.post(invite, 'users/invite', { body: { email: 'cashier@barstock.test', role: 'cashier' } }))
                .status
        ).toBe(409)
        expect(
            (await admin.post(invite, 'users/invite', { body: { email: `${uniq('y')}@barstock.test`, role: 'owner' } }))
                .status
        ).toBe(422)
    })
})
