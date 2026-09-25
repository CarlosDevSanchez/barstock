import { assertNoError } from '@/lib/server/errors'
import { ok, route } from '@/lib/server/http'
import { pushSubscriptionSchema, deletePushSubscriptionSchema } from '@/lib/validation/notifications'
import type { AppSupabaseClient } from '@/lib/server/supabase'

/** push_subscriptions is not in generated Database yet (regen with bun run db:types after merge). */
function pushTable(supabase: AppSupabaseClient) {
    return supabase.from('push_subscriptions' as 'profiles') as unknown as {
        insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string; code?: string } | null }>
        update: (row: Record<string, unknown>) => {
            eq: (
                column: string,
                value: unknown
            ) => {
                eq: (column: string, value: unknown) => PromiseLike<{ error: { message: string } | null }>
            }
        }
        delete: () => {
            eq: (
                column: string,
                value: unknown
            ) => {
                eq: (column: string, value: unknown) => PromiseLike<{ error: { message: string } | null }>
            }
        }
    }
}

export const POST = route({
    role: 'cashier',
    body: pushSubscriptionSchema,
    handler: async ({ supabase, user, body }) => {
        const table = pushTable(supabase)
        // Drop a previous subscription for this endpoint owned by the caller, then insert (or refresh keys).
        const { error: delError } = await table.delete().eq('endpoint', body.endpoint).eq('user_id', user.id)
        assertNoError(delError)

        const { error } = await table.insert({
            user_id: user.id,
            endpoint: body.endpoint,
            p256dh: body.p256dh,
            auth: body.auth,
            user_agent: body.user_agent ?? null
        })
        if (error?.code === '23505') {
            // Endpoint still taken (another user): refresh is not allowed.
            assertNoError(error)
        }
        assertNoError(error)
        return ok({ ok: true as const })
    }
})

export const DELETE = route({
    role: 'cashier',
    body: deletePushSubscriptionSchema,
    handler: async ({ supabase, user, body }) => {
        const { error } = await pushTable(supabase).delete().eq('endpoint', body.endpoint).eq('user_id', user.id)
        assertNoError(error)
        return ok({ ok: true as const })
    }
})
