// Seeds a LOCAL Supabase with just the users needed to log in (admin/manager/cashier). Nothing else: no demo sales,
// no extra data — the rest of the database is whatever supabase/seed.sql and the migrations already provide.
//
//   bun run local:seed            # also run by `bun run local:up` / `local:dev`
//
// Idempotent: users are created once and their password/role/activation are reset on every run. It refuses to run
// against anything that is not localhost: these credentials are public.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run this through `bun run local:seed`.')
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

await ensureUsers()
console.log('\nUsers ready (LOCAL ONLY):')
for (const user of LOCAL_USERS) console.log(`  ${user.role.padEnd(8)} ${user.email}   password: ${LOCAL_PASSWORD}`)
