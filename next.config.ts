import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { parseEnv, serverEnvSchema } from './lib/env/schema'

// Fail fast (dev and build) naming any missing variable, instead of `supabaseUrl is required` deep inside a page.
parseEnv(serverEnvSchema, process.env)
const isDev = process.env.NODE_ENV === 'development'

// Everything is self-hosted (fonts come from next/font). Next.js needs inline scripts/styles for hydration;
// a nonce-based CSP would force dynamic rendering of every page, so 'unsafe-inline' stays for now.
// The browser only talks to this origin (/api/v1); Supabase is reached from the server.
const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
].join('; ')

const securityHeaders = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' }
]

const nextConfig: NextConfig = {
    // Next 16.3 appends a block to AGENTS.md/CLAUDE.md on every `next dev`; those files are maintained by hand.
    agentRules: false,
    poweredByHeader: false,
    // next/image is not used: skip the image optimizer endpoint.
    images: { unoptimized: true },
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }]
    }
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
