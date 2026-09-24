import 'server-only'
import { Resend } from 'resend'
import webpush, { WebPushError } from 'web-push'
import { serverEnv } from '@/lib/env/server'
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin'

type DbResult<T = unknown> = { data: T; error: { message: string } | null }

/** Query builder stand-in for tables/RPCs not yet in generated Database (regen after merge). */
type LooseQuery = PromiseLike<DbResult> & {
    eq: (column: string, value: unknown) => LooseQuery
    in: (column: string, values: unknown[]) => LooseQuery
    maybeSingle: () => PromiseLike<DbResult>
}

type UntypedAdmin = {
    rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<DbResult>
    from: (table: string) => {
        select: (columns: string) => LooseQuery
        update: (values: Record<string, unknown>) => LooseQuery
        delete: () => LooseQuery
    }
}

function adminDb(): UntypedAdmin {
    return createSupabaseAdminClient() as unknown as UntypedAdmin
}

export type OutboxKind = 'low_stock' | 'business_day_auto_closed' | 'receivable_due'

export interface OutboxRow {
    id: number
    kind: OutboxKind
    payload: Record<string, unknown>
    created_at: string
    processed_at: string | null
    attempts: number
    last_error: string | null
}

interface StaffRecipient {
    id: string
    email: string
    full_name: string | null
    role: string
    notify_email: boolean
    notify_push: boolean
}

interface PushRow {
    id: string
    user_id: string
    endpoint: string
    p256dh: string
    auth: string
}

function opt(name: string): string | undefined {
    const value = process.env[name]
    return value === undefined || value === '' ? undefined : value
}

function emailConfigured(): boolean {
    return Boolean(opt('RESEND_API_KEY') && opt('EMAIL_FROM'))
}

function pushConfigured(): boolean {
    return Boolean(opt('VAPID_PUBLIC_KEY') && opt('VAPID_PRIVATE_KEY') && opt('VAPID_SUBJECT'))
}

function appBaseUrl(): string {
    return serverEnv.APP_URL.replace(/\/$/, '')
}

function settingAsBoolean(value: unknown): boolean {
    if (value === true || value === false) return value
    if (typeof value === 'string') return value === 'true'
    return false
}

function summarize(rows: OutboxRow[]): { title: string; body: string; url: string } {
    const low = rows.filter(r => r.kind === 'low_stock').length
    const closed = rows.filter(r => r.kind === 'business_day_auto_closed').length
    const due = rows.filter(r => r.kind === 'receivable_due').length
    const parts: string[] = []
    if (low) parts.push(`${low} low-stock alert${low === 1 ? '' : 's'}`)
    if (closed) parts.push(`${closed} business day${closed === 1 ? '' : 's'} auto-closed`)
    if (due) parts.push(`${due} receivable${due === 1 ? '' : 's'} due`)
    const body = parts.length > 0 ? parts.join(' · ') : 'New staff alert'
    const url =
        low > 0 ? `${appBaseUrl()}/inventory?low=1` : due > 0 ? `${appBaseUrl()}/orders` : `${appBaseUrl()}/dashboard`
    return { title: 'Barstock', body, url }
}

async function loadRecipients(db: UntypedAdmin): Promise<StaffRecipient[]> {
    const { data: flagRow, error: flagError } = await db
        .from('settings')
        .select('value')
        .eq('key', 'low_stock_notify_managers')
        .maybeSingle()
    if (flagError) console.error('[notifications] settings read failed', flagError)

    const managersEnabled = settingAsBoolean(
        flagRow && typeof flagRow === 'object' && flagRow !== null && 'value' in flagRow
            ? (flagRow as { value: unknown }).value
            : undefined
    )
    const roles = managersEnabled ? ['admin', 'manager'] : ['admin']

    const { data: profiles, error: profileError } = await db
        .from('profiles')
        .select('id, email, full_name, role, notify_email, notify_push')
        .eq('is_active', true)
        .in('role', roles)

    if (profileError) {
        console.error('[notifications] recipients query failed', profileError)
        return []
    }

    return (profiles as StaffRecipient[] | null) ?? []
}

async function markSuccess(db: UntypedAdmin, id: number): Promise<void> {
    const { error } = await db
        .from('notification_outbox')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', id)
    if (error) console.error('[notifications] mark success failed', id, error)
}

async function markFailure(db: UntypedAdmin, row: OutboxRow, message: string): Promise<void> {
    const attempts = row.attempts + 1
    const patch: Record<string, unknown> = {
        attempts,
        last_error: message.slice(0, 500),
        claimed_at: null
    }
    if (attempts >= 5) patch.processed_at = new Date().toISOString()
    const { error } = await db.from('notification_outbox').update(patch).eq('id', row.id)
    if (error) console.error('[notifications] mark failure failed', row.id, error)
}

async function sendEmail(to: string, title: string, body: string, url: string): Promise<void> {
    const apiKey = opt('RESEND_API_KEY')
    const from = opt('EMAIL_FROM')
    if (!apiKey || !from) return
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
        from,
        to,
        subject: title,
        text: `${body}\n\n${url}`
    })
    if (error) throw new Error(error.message)
}

async function sendPush(db: UntypedAdmin, subs: PushRow[], title: string, body: string, url: string): Promise<void> {
    const subject = opt('VAPID_SUBJECT')
    const publicKey = opt('VAPID_PUBLIC_KEY')
    const privateKey = opt('VAPID_PRIVATE_KEY')
    if (!subject || !publicKey || !privateKey || subs.length === 0) return
    webpush.setVapidDetails(subject, publicKey, privateKey)
    const payload = JSON.stringify({ title, body, url })
    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload
            )
        } catch (error: unknown) {
            const status =
                error instanceof WebPushError
                    ? error.statusCode
                    : typeof error === 'object' && error && 'statusCode' in error
                      ? Number((error as { statusCode: unknown }).statusCode)
                      : 0
            if (status === 404 || status === 410) {
                const { error: delError } = await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
                if (delError) console.error('[notifications] delete dead push sub failed', delError)
                continue
            }
            throw error instanceof Error ? error : new Error(String(error))
        }
    }
}

/**
 * Claims pending outbox rows and delivers one summary per staff recipient (email and/or push).
 * Never throws: missing keys skip that channel; per-row failures bump attempts.
 */
export async function dispatchOutbox(): Promise<void> {
    try {
        const db = adminDb()
        const { data, error } = await db.rpc('_claim_outbox', { p_limit: 50 })
        if (error) {
            console.error('[notifications] claim failed', error)
            return
        }
        const rows = (data as OutboxRow[] | null) ?? []
        if (rows.length === 0) return

        const recipients = await loadRecipients(db)
        if (recipients.length === 0) {
            for (const row of rows) await markSuccess(db, row.id)
            return
        }

        const summary = summarize(rows)
        const userIds = recipients.map(r => r.id)
        const { data: subData, error: subError } = await db
            .from('push_subscriptions')
            .select('id, user_id, endpoint, p256dh, auth')
            .in('user_id', userIds)
        if (subError) console.error('[notifications] push_subscriptions read failed', subError)
        const allSubs = (subData as PushRow[] | null) ?? []

        let deliveryError: string | null = null
        for (const recipient of recipients) {
            try {
                if (recipient.notify_email && emailConfigured()) {
                    await sendEmail(recipient.email, summary.title, summary.body, summary.url)
                }
                if (recipient.notify_push && pushConfigured()) {
                    await sendPush(
                        db,
                        allSubs.filter(s => s.user_id === recipient.id),
                        summary.title,
                        summary.body,
                        summary.url
                    )
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err)
                console.error('[notifications] delivery failed for', recipient.id, message)
                deliveryError = message
            }
        }

        for (const row of rows) {
            if (deliveryError) await markFailure(db, row, deliveryError)
            else await markSuccess(db, row.id)
        }
    } catch (error: unknown) {
        console.error('[notifications] dispatchOutbox crashed', error)
    }
}
