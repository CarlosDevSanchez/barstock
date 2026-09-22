import { spawnSync } from 'node:child_process'

export const PLACEHOLDER = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    APP_URL: 'http://localhost:3000'
} as const

export interface LocalSupabase {
    API_URL: string
    ANON_KEY: string
    SERVICE_ROLE_KEY: string
    MAILPIT_URL: string
}

/** Reads the running local stack from `supabase status -o env`. Null when the CLI or the stack is not available. */
export function readLocalSupabase(): LocalSupabase | null {
    const result = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', timeout: 20_000 })
    if (result.status !== 0 || !result.stdout) return null
    const values: Record<string, string> = {}
    for (const line of result.stdout.split('\n')) {
        const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim())
        if (match?.[1]) values[match[1]] = match[2] ?? ''
    }
    const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = values
    if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return null
    return { API_URL, ANON_KEY, SERVICE_ROLE_KEY, MAILPIT_URL: values.MAILPIT_URL ?? 'http://127.0.0.1:54324' }
}

const isPlaceholder = () =>
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === PLACEHOLDER.SUPABASE_SERVICE_ROLE_KEY

/**
 * Makes `process.env` point at the local Supabase stack when the caller did not configure one, and otherwise falls back
 * to inert placeholders so modules that validate env at import time still load in pure unit tests.
 */
export function applyTestEnv(): void {
    if (isPlaceholder()) {
        const local = readLocalSupabase()
        if (local) {
            process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = local.ANON_KEY
            process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY
            process.env.MAILPIT_URL ??= local.MAILPIT_URL
        }
    }
    for (const [key, value] of Object.entries(PLACEHOLDER)) process.env[key] ??= value
}
