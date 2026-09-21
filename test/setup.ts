import { mock } from 'bun:test'
import { applyTestEnv } from './helpers/supabase-env'

// `server-only` throws outside React Server Components; neutralize it in tests.
void mock.module('server-only', () => ({}))

// Point at the local Supabase stack when it is running; otherwise inert placeholders (pure unit tests still load).
applyTestEnv()
