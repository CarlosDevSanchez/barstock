import { mock } from 'bun:test'

// `server-only` throws outside React Server Components; neutralize it in tests.
void mock.module('server-only', () => ({}))
