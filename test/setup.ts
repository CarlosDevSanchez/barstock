import { mock } from 'bun:test'

// `server-only` throws outside React Server Components; neutralize it in tests.
void mock.module('server-only', () => ({}))

// Defaults so modules that validate env at import time load in unit tests. Real values (.env / CI) win.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
process.env.APP_URL ??= 'http://localhost:3000'
