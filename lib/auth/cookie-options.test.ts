import { afterEach, describe, expect, test } from 'bun:test'
import { sessionCookieOptions } from './cookie-options'

const original = process.env.APP_URL
afterEach(() => {
    process.env.APP_URL = original
})

describe('sessionCookieOptions', () => {
    test('always makes the cookie unreadable by scripts, and keeps the rest of the options', () => {
        const options = sessionCookieOptions({ path: '/', sameSite: 'lax' as const, maxAge: 100, httpOnly: false })
        expect(options).toMatchObject({ path: '/', sameSite: 'lax', maxAge: 100, httpOnly: true })
    })

    test('is Secure exactly when the app is served over https', () => {
        process.env.APP_URL = 'https://shop.example.com'
        expect(sessionCookieOptions({}).secure).toBe(true)
        process.env.APP_URL = 'http://localhost:3000'
        expect(sessionCookieOptions({}).secure).toBe(false)
    })

    test('a production build served over plain http (the Docker setup) still gets usable cookies', () => {
        // Regression: keying on NODE_ENV made Safari drop the session cookie on http://localhost.
        process.env.APP_URL = 'http://localhost:3000'
        expect(sessionCookieOptions({ secure: true }).secure).toBe(false)
    })

    test('works when the library passes no options', () => {
        process.env.APP_URL = 'http://localhost:3000'
        expect(sessionCookieOptions()).toEqual({ httpOnly: true, secure: false })
    })
})
