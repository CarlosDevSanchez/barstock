import { afterEach, describe, expect, test } from 'bun:test'
import { sessionCookieOptions } from './cookie-options'

// Next's typings make NODE_ENV read-only; it is a plain env var at runtime.
const setNodeEnv = (value: string | undefined) => Reflect.set(process.env, 'NODE_ENV', value)
const original = process.env.NODE_ENV
afterEach(() => setNodeEnv(original))

describe('sessionCookieOptions', () => {
    test('always makes the cookie unreadable by scripts, and keeps the rest of the options', () => {
        const options = sessionCookieOptions({ path: '/', sameSite: 'lax' as const, maxAge: 100, httpOnly: false })
        expect(options).toMatchObject({ path: '/', sameSite: 'lax', maxAge: 100, httpOnly: true })
    })

    test('is Secure in production only', () => {
        setNodeEnv('production')
        expect(sessionCookieOptions({}).secure).toBe(true)
        setNodeEnv('development')
        expect(sessionCookieOptions({}).secure).toBe(false)
    })

    test('works when the library passes no options', () => {
        expect(sessionCookieOptions()).toEqual({ httpOnly: true, secure: false })
    })
})
