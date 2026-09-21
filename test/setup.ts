import { mock } from 'bun:test'

// `server-only` lanza un error fuera de React Server Components; en los tests se neutraliza.
void mock.module('server-only', () => ({}))
