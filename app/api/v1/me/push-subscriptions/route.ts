import { assertNoError } from '@/lib/server/errors'
import { ok, route } from '@/lib/server/http'
import { pushSubscriptionSchema, deletePushSubscriptionSchema } from '@/lib/validation/notifications'
import type { AppSupabaseClient } from '@/lib/server/supabase'

/** push_subscriptions is not in generated Database yet (regen with bun run db:types after merge). */
function pushTable(supabase: AppSupabaseClient) {
    return supabase.from('push_subscriptions' as 'profiles') as unknown as {
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

/** Call an RPC that is not yet in the generated Database types (regen with `bun run db:types` after merge). */
async function callRpc(
    supabase: AppSupabaseClient,
    fn: string,
    args: Record<string, unknown>
): Promise<{ data: unknown; error: Parameters<typeof assertNoError>[0] }> {
    const result = await (
        supabase as unknown as {
            rpc: (
                name: string,
                params: Record<string, unknown>
            ) => PromiseLike<{ data: unknown; error: Parameters<typeof assertNoError>[0] }>
        }
    ).rpc(fn, args)
    return result
}

export const POST = route({
    role: 'cashier',
    body: pushSubscriptionSchema,
    handler: async ({ supabase, body }) => {
        // U5: register_push_subscription upserts by endpoint and reassigns user_id to the caller, so a shared
        // device where a different user previously subscribed with this same browser endpoint does not 409.
        const { error } = await callRpc(supabase, 'register_push_subscription', {
            p_endpoint: body.endpoint,
            p_p256dh: body.p256dh,
            p_auth: body.auth,
            p_user_agent: body.user_agent ?? null
        })
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
