import { after } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin'
import { dispatchOutbox } from '@/lib/server/services/notifications'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * Daily lazy close + receivable reminders + outbox dispatch. Vercel Cron has no user session, so this uses the
 * service role only for RPCs granted to service_role (not to anon or authenticated).
 */
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET
    if (!secret) {
        return Response.json(
            { error: { code: 'cron_not_configured', message: 'CRON_SECRET is not set' } },
            { status: 503, headers: noStore }
        )
    }
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
        return Response.json(
            { error: { code: 'unauthorized', message: 'Authentication required' } },
            { status: 401, headers: noStore }
        )
    }

    const admin = createSupabaseAdminClient()
    const { error } = await admin.rpc('_auto_close_stale_business_days')
    if (error) {
        return Response.json(
            { error: { code: 'internal_error', message: 'Could not close stale business days' } },
            { status: 500, headers: noStore }
        )
    }

    const enqueue = await (
        admin.rpc as unknown as (
            fn: string,
            args?: Record<string, unknown>
        ) => PromiseLike<{ error: { message: string } | null }>
    )('_enqueue_due_receivables')
    if (enqueue.error) {
        return Response.json(
            { error: { code: 'internal_error', message: 'Could not enqueue due receivables' } },
            { status: 500, headers: noStore }
        )
    }

    after(() => {
        void dispatchOutbox()
    })
    return Response.json({ data: { ok: true } }, { headers: noStore })
}
