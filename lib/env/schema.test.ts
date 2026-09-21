import { describe, expect, test } from 'bun:test'
import { clientEnvSchema, EnvError, parseEnv, serverEnvSchema } from './schema'

const valid = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    APP_URL: 'http://localhost:3000'
}

describe('parseEnv', () => {
    test('accepts a complete environment', () => {
        expect(parseEnv(serverEnvSchema, valid)).toEqual(valid)
    })

    test('the client schema does not require server-only variables', () => {
        const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = valid
        expect(parseEnv(clientEnvSchema, { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY })).toEqual({
            NEXT_PUBLIC_SUPABASE_URL,
            NEXT_PUBLIC_SUPABASE_ANON_KEY
        })
    })

    test('names each missing variable', () => {
        let error: unknown
        try {
            parseEnv(serverEnvSchema, { NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL })
        } catch (e: unknown) {
            error = e
        }
        expect(error).toBeInstanceOf(EnvError)
        expect((error as EnvError).problems).toEqual([
            'NEXT_PUBLIC_SUPABASE_ANON_KEY: missing',
            'SUPABASE_SERVICE_ROLE_KEY: missing',
            'APP_URL: missing'
        ])
    })

    test('treats empty strings as missing', () => {
        expect(() => parseEnv(serverEnvSchema, { ...valid, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow(
            'SUPABASE_SERVICE_ROLE_KEY: missing'
        )
    })

    test('reports invalid values', () => {
        expect(() => parseEnv(serverEnvSchema, { ...valid, APP_URL: 'not a url' })).toThrow(/APP_URL: /)
    })

    test('ignores unrelated variables', () => {
        expect(parseEnv(serverEnvSchema, { ...valid, PATH: '/bin' })).toEqual(valid)
    })
})
