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

describe('R2 variables (lib/server/storage.ts), optional as a group', () => {
    const r2 = {
        R2_ACCOUNT_ID: 'account',
        R2_ACCESS_KEY_ID: 'key-id',
        R2_SECRET_ACCESS_KEY: 'secret',
        R2_BUCKET: 'bucket'
    }

    test('none of the four is valid: build/CI must work before the bucket is provisioned', () => {
        expect(parseEnv(serverEnvSchema, valid)).toMatchObject(valid)
    })

    test('all four together are valid', () => {
        expect(parseEnv(serverEnvSchema, { ...valid, ...r2 })).toEqual({ ...valid, ...r2 })
    })

    test('a partial set is rejected, naming every missing R2 variable', () => {
        let error: unknown
        try {
            parseEnv(serverEnvSchema, { ...valid, R2_ACCOUNT_ID: r2.R2_ACCOUNT_ID, R2_BUCKET: r2.R2_BUCKET })
        } catch (e: unknown) {
            error = e
        }
        expect(error).toBeInstanceOf(EnvError)
        expect((error as EnvError).problems).toEqual(['R2_ACCESS_KEY_ID: missing', 'R2_SECRET_ACCESS_KEY: missing'])
    })

    test('a single R2 variable alone is rejected', () => {
        expect(() => parseEnv(serverEnvSchema, { ...valid, R2_BUCKET: r2.R2_BUCKET })).toThrow(/R2_ACCOUNT_ID: missing/)
    })
})

describe('notification variables (lib/server/services/notifications.ts), optional as a group', () => {
    const notify = {
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'Barstock <alerts@example.com>',
        VAPID_PUBLIC_KEY: 'vapid-pub',
        VAPID_PRIVATE_KEY: 'vapid-priv',
        VAPID_SUBJECT: 'mailto:ops@example.com'
    }

    test('none of the five is valid: build/CI must work before email/push are provisioned', () => {
        expect(parseEnv(serverEnvSchema, valid)).toMatchObject(valid)
    })

    test('all five together are valid', () => {
        expect(parseEnv(serverEnvSchema, { ...valid, ...notify })).toEqual({ ...valid, ...notify })
    })

    test('a partial set is rejected, naming every missing notification variable', () => {
        let error: unknown
        try {
            parseEnv(serverEnvSchema, {
                ...valid,
                RESEND_API_KEY: notify.RESEND_API_KEY,
                VAPID_PUBLIC_KEY: notify.VAPID_PUBLIC_KEY
            })
        } catch (e: unknown) {
            error = e
        }
        expect(error).toBeInstanceOf(EnvError)
        expect((error as EnvError).problems).toEqual([
            'EMAIL_FROM: missing',
            'VAPID_PRIVATE_KEY: missing',
            'VAPID_SUBJECT: missing'
        ])
    })
})
