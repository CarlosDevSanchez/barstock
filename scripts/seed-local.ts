// Seeds a LOCAL Supabase with the users (and a little sales history) needed to log in and look around the app.
//
//   bun run local:seed            # also run by `bun run local:up`
//
// Idempotent: users are created once and their password/role/activation are reset on every run; demo sales are created only
// when there are no orders yet. It refuses to run against anything that is not localhost: these credentials are public.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!url || !anonKey || !serviceKey) {
    console.error(
        'Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Run this through `bun run local:seed`.'
    )
    process.exit(1)
}
const host = new URL(url).hostname
if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error(
        `Refusing to seed ${host}: these are public development credentials and only a LOCAL Supabase is allowed.`
    )
    process.exit(1)
}

export const LOCAL_PASSWORD = process.env.LOCAL_USERS_PASSWORD ?? 'barstock-local-2026'
export const LOCAL_USERS = [
    { email: 'admin@barstock.local', role: 'admin', name: 'Local Admin' },
    { email: 'manager@barstock.local', role: 'manager', name: 'Local Manager' },
    { email: 'cashier@barstock.local', role: 'cashier', name: 'Local Cashier' }
] as const

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient<Database>(url, serviceKey, options)

async function ensureUsers() {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (error) throw error
    for (const wanted of LOCAL_USERS) {
        const existing = data.users.find(user => user.email === wanted.email)
        let id = existing?.id
        if (existing) {
            const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
                password: LOCAL_PASSWORD,
                user_metadata: { full_name: wanted.name }
            })
            if (updateError) throw updateError
        } else {
            const created = await admin.auth.admin.createUser({
                email: wanted.email,
                password: LOCAL_PASSWORD,
                email_confirm: true,
                // The role goes in app_metadata (only the server can write it); a trigger copies it to the profile and activates it.
                app_metadata: { role: wanted.role },
                user_metadata: { full_name: wanted.name }
            })
            if (created.error || !created.data.user)
                throw created.error ?? new Error(`could not create ${wanted.email}`)
            id = created.data.user.id
        }
        // service_role has no auth.uid(), so the profile trigger lets this reset through.
        const { error: profileError } = await admin
            .from('profiles')
            .update({ role: wanted.role, is_active: true, full_name: wanted.name, locale: 'en' })
            .eq('id', id ?? '')
        if (profileError) throw profileError
    }
}

async function signIn(email: string) {
    const client = createClient<Database>(url, anonKey, options)
    const { error } = await client.auth.signInWithPassword({ email, password: LOCAL_PASSWORD })
    if (error) throw error
    return client
}

const walkIn = null as unknown as string // the generated type says `string`; the function accepts NULL (walk-in customer)

// A few sales through the real RPC, as the cashier and the manager, so the dashboard, orders and reports are not empty.
async function demoSales() {
    const { count } = await admin.from('orders').select('*', { count: 'exact', head: true })
    if ((count ?? 0) > 0) return 'skipped (there are already orders)'

    const [cashier, manager] = await Promise.all([signIn('cashier@barstock.local'), signIn('manager@barstock.local')])
    const { data: products } = await manager.from('products').select('id, name').eq('is_active', true).order('name')
    const { data: customers } = await manager.from('customers').select('id').order('name').limit(2)
    if (!products?.length) return 'skipped (no products; is the seed loaded?)'
    const stockUnits = (await admin.from('inventory').select('product_id, quantity').is('variant_id', null)).data ?? []
    const sellable = products.filter(
        product => (stockUnits.find(row => row.product_id === product.id)?.quantity ?? 0) >= 10
    )

    const plan: Array<{
        by: typeof cashier
        lines: number[]
        method: 'cash' | 'card' | 'ewallet'
        customer?: string
        discount?: number
    }> = [
        { by: cashier, lines: [0, 1], method: 'cash' },
        { by: cashier, lines: [2], method: 'card', customer: customers?.[0]?.id },
        { by: cashier, lines: [0, 3], method: 'ewallet', discount: 2 },
        { by: manager, lines: [1], method: 'cash' },
        { by: manager, lines: [2, 3], method: 'card', customer: customers?.[1]?.id },
        { by: cashier, lines: [1, 2], method: 'cash' }
    ]
    const orderIds: string[] = []
    for (const [index, sale] of plan.entries()) {
        const items = sale.lines.flatMap(line => {
            const product = sellable[line % sellable.length]
            return product ? [{ product_id: product.id, quantity: 1 + (index % 2) }] : []
        })
        const { data, error } = await sale.by.rpc('create_sale', {
            p_customer_id: (sale.customer ?? walkIn) as string,
            p_items: items,
            p_payment_method: sale.method,
            p_discount: sale.discount ?? 0
        })
        if (error) throw error
        orderIds.push(data)
    }
    const refundable = orderIds[3]
    if (refundable) {
        const { error } = await manager.rpc('refund_order', {
            p_order_id: refundable,
            p_reason: 'Demo refund: customer returned the item'
        })
        if (error) throw error
    }
    return `${orderIds.length} sales (1 refunded)`
}

await ensureUsers()
console.log('\nUsers ready (LOCAL ONLY):')
for (const user of LOCAL_USERS) console.log(`  ${user.role.padEnd(8)} ${user.email}   password: ${LOCAL_PASSWORD}`)
console.log(`Demo sales: ${await demoSales()}`)
