import { assertNoError } from '@/lib/server/errors'
import { ok, route } from '@/lib/server/http'
import { notificationPrefsSchema } from '@/lib/validation/notifications'
import type { AppSupabaseClient } from '@/lib/server/supabase'

async function setPrefs(supabase: AppSupabaseClient, email: boolean, push: boolean) {
    const { error } = await (
        supabase.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>
        ) => PromiseLike<{ error: { message: string } | null }>
    )('set_notification_prefs', { p_email: email, p_push: push })
    assertNoError(error)
}

export const PATCH = route({
    role: 'cashier',
    body: notificationPrefsSchema,
    handler: async ({ supabase, body }) => {
        await setPrefs(supabase, body.notify_email, body.notify_push)
        return ok({ notify_email: body.notify_email, notify_push: body.notify_push })
    }
})
