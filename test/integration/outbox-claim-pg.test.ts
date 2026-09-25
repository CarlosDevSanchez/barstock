import { SQL } from 'bun'
import { beforeAll, describe, expect, test } from 'bun:test'
import { adminClient, requireLocalSupabase } from '../helpers/integration'

/**
 * `_claim_outbox` locking, tested with two REAL Postgres connections (Bun's built-in `Bun.SQL`, no new dependency)
 * instead of two supabase-js RPC calls racing through PostgREST's own connection pool. This is the "two real `pg`
 * connections" case the plan (§4) and H6's "Pendiente" section asked for: T1 claims and holds its transaction open
 * (uncommitted), T2 claims concurrently — `for update skip locked` must hand them disjoint rows, and the union of
 * both claims must equal every eligible row, with no row claimed by both.
 *
 * Local-only by construction: `requireLocalSupabase()` already refuses a non-local Supabase URL (hard rule 10),
 * and the direct Postgres port here (54322) is the fixed default `supabase start` always binds it to.
 */

const service = () => adminClient() as unknown as UntypedDb
type UntypedDb = {
    from: (table: string) => {
        select: (columns?: string) => LooseQ
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => PromiseLike<DbRes>
        delete: () => LooseQ
    }
}
type DbRes = { data: unknown; error: { message: string } | null }
type LooseQ = PromiseLike<DbRes> & { eq: (c: string, v: unknown) => LooseQ }

function localDbUrl(): string {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname
    if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(`Refusing a direct Postgres connection to ${host}: only a LOCAL Supabase is allowed.`)
    }
    return `postgresql://postgres:postgres@${host}:54322/postgres`
}

async function clearOutbox(): Promise<void> {
    const { data } = await service().from('notification_outbox').select('id')
    const ids = ((data as Array<{ id: number }> | null) ?? []).map(r => r.id)
    for (const id of ids) await service().from('notification_outbox').delete().eq('id', id)
}

beforeAll(requireLocalSupabase)

describe('_claim_outbox with two real Postgres connections', () => {
    test('two concurrent, overlapping claims never return the same row, and together cover every eligible row', async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
            await clearOutbox()
            const rows = Array.from({ length: 12 }, (_, i) => ({
                kind: 'low_stock',
                payload: { inventory_id: crypto.randomUUID(), product_id: crypto.randomUUID(), quantity: i }
            }))
            const { error: insertError } = await service().from('notification_outbox').insert(rows)
            expect(insertError).toBeNull()

            const sql = new SQL(localDbUrl())
            try {
                const t1 = await sql.reserve()
                try {
                    await t1.unsafe('BEGIN')
                    // T1 claims and holds the row locks open (no COMMIT yet) — this is the case a
                    // supabase-js-only test cannot exercise: two RPC calls each auto-commit before the other
                    // even starts, so `for update skip locked` never actually has to skip a row someone else
                    // is mid-transaction on.
                    const claimed1 = (await t1.unsafe(
                        'select id from public._claim_outbox($1)',
                        [50]
                    )) as unknown as Array<{ id: number }>

                    // T2 runs on a separate pooled connection while T1's transaction is still open.
                    const claimed2 = (await sql.unsafe(
                        'select id from public._claim_outbox($1)',
                        [50]
                    )) as unknown as Array<{ id: number }>

                    await t1.unsafe('COMMIT')

                    const ids1 = claimed1.map(r => r.id)
                    const ids2 = claimed2.map(r => r.id)
                    const overlap = ids1.filter(id => ids2.includes(id))
                    expect(overlap).toEqual([])

                    const union = new Set([...ids1, ...ids2])
                    expect(union.size).toBe(rows.length)
                } finally {
                    await t1.release()
                }
            } finally {
                await sql.close()
            }
        }
    })
})
