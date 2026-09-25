import { describe, expect, test } from 'bun:test'
import type { AppSupabaseClient } from './supabase'
import { loadSession } from './auth'

interface ProfileResponse {
    data: Record<string, unknown> | null
    error: { message: string; code?: string } | null
}

function fakeClient(responses: ProfileResponse[]): AppSupabaseClient {
    let call = 0
    return {
        auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@shop.com' } }, error: null }) },
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => responses[Math.min(call++, responses.length - 1)]
                })
            })
        })
    } as unknown as AppSupabaseClient
}

describe('loadSession', () => {
    test('D9/F4: falls back to a select without notify_* on 42703 (code deployed ahead of migration 20261005000004)', async () => {
        const supabase = fakeClient([
            { data: null, error: { message: 'column "notify_email" does not exist', code: '42703' } },
            { data: { role: 'admin', full_name: 'Ana', is_active: true, locale: 'es' }, error: null }
        ])
        const session = await loadSession(supabase)
        expect(session?.user.role).toBe('admin')
        expect(session?.user.notifyEmail).toBe(true)
        expect(session?.user.notifyPush).toBe(true)
    })

    test('a non-42703 profile error still fails the session', async () => {
        const supabase = fakeClient([{ data: null, error: { message: 'connection reset' } }])
        const session = await loadSession(supabase)
        expect(session).toBeNull()
    })

    test('returns null when the 42703 fallback also fails', async () => {
        const supabase = fakeClient([
            { data: null, error: { message: 'boom', code: '42703' } },
            { data: null, error: { message: 'still broken' } }
        ])
        const session = await loadSession(supabase)
        expect(session).toBeNull()
    })
})
