import { clientEnvSchema, parseEnv } from './schema'

// Next only inlines `process.env.NEXT_PUBLIC_*` when referenced statically, so `process.env` is not passed whole.
export const clientEnv = parseEnv(clientEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
})
