import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert } from '@/types/database'
import { PLACEHOLDER } from './supabase-env'

export type Db = SupabaseClient<Database>
export type TestRole = 'admin' | 'manager' | 'cashier'

export const TEST_PASSWORD = 'barstock-test-password-1'
const EMAIL: Record<TestRole | 'inactive', string> = {
    admin: 'admin@barstock.test',
    manager: 'manager@barstock.test',
    cashier: 'cashier@barstock.test',
    inactive: 'inactive@barstock.test'
}

const env = () => ({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    service: process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
})

let checked: Promise<void> | undefined

/**
 * Integration tests create users and write data. They must NEVER run against a real project (hard rule 10): only a local
 * Supabase (`bun run db:start`) is accepted, and an unreachable one fails with an actionable message.
 */
export function requireLocalSupabase(): Promise<void> {
    checked ??= (async () => {
        const { url, service } = env()
        if (service === PLACEHOLDER.SUPABASE_SERVICE_ROLE_KEY || !service) {
            throw new Error(
                'Integration tests need the local Supabase stack. Run `bun run db:start` (Docker must be running).'
            )
        }
        const host = new URL(url).hostname
        if (host !== '127.0.0.1' && host !== 'localhost') {
            throw new Error(`Refusing to run integration tests against ${host}: only a LOCAL Supabase is allowed.`)
        }
        const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: env().anon } }).catch(() => null)
        if (!health?.ok) throw new Error(`Local Supabase is not reachable at ${url}. Run \`bun run db:start\`.`)
    })()
    return checked
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }

/** service_role client: bypasses RLS. Test setup and assertions only, never the code under test. */
export function adminClient(): Db {
    const { url, service } = env()
    return createClient<Database>(url, service, options)
}

export const uniq = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

export interface TestUser {
    id: string
    email: string
}
export type TestUsers = Record<TestRole | 'inactive', TestUser>

let usersPromise: Promise<TestUsers> | undefined

/** Idempotent: creates the role users once and resets their role/activation/password on every run. */
export function ensureTestUsers(): Promise<TestUsers> {
    usersPromise ??= (async () => {
        await requireLocalSupabase()
        const admin = adminClient()
        const { data: existing, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
        if (error) throw error

        const result = {} as TestUsers
        for (const key of Object.keys(EMAIL) as Array<keyof typeof EMAIL>) {
            const email = EMAIL[key]
            const role: TestRole = key === 'inactive' ? 'cashier' : key
            let user = existing.users.find(candidate => candidate.email === email)
            if (!user) {
                const created = await admin.auth.admin.createUser({
                    email,
                    password: TEST_PASSWORD,
                    email_confirm: true,
                    app_metadata: { role }
                })
                if (created.error || !created.data.user) throw created.error ?? new Error(`could not create ${email}`)
                user = created.data.user
            } else {
                const updated = await admin.auth.admin.updateUserById(user.id, { password: TEST_PASSWORD })
                if (updated.error) throw updated.error
            }
            // service_role has no auth.uid(), so the profile trigger lets this through.
            const { error: profileError } = await admin
                .from('profiles')
                .update({ role, is_active: key !== 'inactive', locale: 'es' })
                .eq('id', user.id)
            if (profileError) throw profileError
            result[key] = { id: user.id, email }
        }
        return result
    })()
    return usersPromise
}

/** supabase-js client signed in as one of the test users (RLS applies, like the app's request-scoped client). */
export async function signedInClient(who: TestRole | 'inactive'): Promise<Db> {
    await ensureTestUsers()
    const { url, anon } = env()
    const client = createClient<Database>(url, anon, options)
    const { error } = await client.auth.signInWithPassword({ email: EMAIL[who], password: TEST_PASSWORD })
    if (error) throw error
    return client
}

// ---- factories (service_role, so they never depend on the policies under test)

export async function createProduct(
    overrides: Partial<TablesInsert<'products'>> & { stock?: number; threshold?: number } = {}
) {
    const { stock = 0, threshold, ...product } = overrides
    const admin = adminClient()
    const { data, error } = await admin
        .from('products')
        .insert({
            name: uniq('Product'),
            sku: uniq('SKU'),
            cost_price: 4,
            selling_price: 10,
            tax_rate: 0.1,
            ...product
        })
        .select()
        .single()
    if (error) throw error
    // The inventory row exists already (trigger); set its quantity directly.
    const { error: stockError } = await admin
        .from('inventory')
        .update({ quantity: stock, ...(threshold === undefined ? {} : { low_stock_threshold: threshold }) })
        .eq('product_id', data.id)
        .is('variant_id', null)
    if (stockError) throw stockError
    return data
}

export async function createCustomer(overrides: Partial<TablesInsert<'customers'>> = {}) {
    const { data, error } = await adminClient()
        .from('customers')
        .insert({ name: uniq('Customer'), ...overrides })
        .select()
        .single()
    if (error) throw error
    return data
}

/**
 * Sets the store currency (settings.currency) and returns a function that puts the previous one back. The seed ships
 * COP (whole pesos); suites that assert cents pin USD in `beforeAll` and restore it in `afterAll`.
 * Test files run one after another, so pinning the setting does not leak into other suites.
 */
export async function pinStoreCurrency(currency: string): Promise<() => Promise<void>> {
    const admin = adminClient()
    const { data, error } = await admin.from('settings').select('value').eq('key', 'currency').single()
    if (error) throw error
    const write = async (value: unknown) => {
        const { error: writeError } = await admin
            .from('settings')
            .upsert({ key: 'currency', value: value as never }, { onConflict: 'key' })
        if (writeError) throw writeError
    }
    await write(currency)
    return () => write(data.value)
}

export async function stockOf(productId: string): Promise<number> {
    const { data, error } = await adminClient()
        .from('inventory')
        .select('quantity')
        .eq('product_id', productId)
        .is('variant_id', null)
        .single()
    if (error) throw error
    return data.quantity
}

export interface MailpitMessage {
    ID: string
    Subject: string
    To: Array<{ Address: string }>
}

/** Waits for the email sent to `address` (Mailpit, part of the local stack) and returns its HTML. */
export async function waitForEmail(address: string, timeoutMs = 10_000): Promise<{ subject: string; html: string }> {
    const base = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const list = (await (await fetch(`${base}/api/v1/messages`)).json()) as { messages: MailpitMessage[] }
        const match = list.messages.find(message =>
            message.To.some(to => to.Address.toLowerCase() === address.toLowerCase())
        )
        if (match) {
            const full = (await (await fetch(`${base}/api/v1/message/${match.ID}`)).json()) as { HTML: string }
            return { subject: match.Subject, html: full.HTML }
        }
        await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`No email for ${address} after ${timeoutMs} ms`)
}

/** The confirm link (`…/auth/confirm?token_hash=…&type=…`) inside an invitation or recovery email. */
export function confirmLinkIn(html: string): URL {
    const match = /href="([^"]*auth\/confirm[^"]*)"/.exec(html)
    if (!match?.[1]) throw new Error('No confirm link in the email')
    return new URL(match[1].replaceAll('&amp;', '&'))
}
