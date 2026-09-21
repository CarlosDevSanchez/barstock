import { defineConfig } from '@playwright/test'
import { applyTestEnv } from './test/helpers/supabase-env'

// Point the runner (global setup, factories) AND the app it starts at the local Supabase stack. Never at a real project.
applyTestEnv()

export default defineConfig({
    testDir: './e2e',
    // `.e2e.ts`, not `.spec.ts`: `bun test` would pick up spec files and try to run them as unit tests.
    testMatch: '**/*.e2e.ts',
    globalSetup: './e2e/global-setup.ts',
    // The specs share one database and create their own uniquely named data, but run one at a time to keep failures readable.
    workers: 1,
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: {
        // Production build: it is what gets deployed, and it exercises the real CSP and headers.
        // CI builds in its own step (with the build logged and timed); locally build and start in one go.
        command: process.env.CI ? 'bun run start' : 'bun run build && bun run start',
        url: 'http://localhost:3000/login',
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: {
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
            APP_URL: 'http://localhost:3000'
        }
    }
})
