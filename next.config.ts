import type { NextConfig } from 'next'
import { parseEnv, serverEnvSchema } from './lib/env/schema'

// Fail fast (dev and build) naming any missing variable, instead of `supabaseUrl is required` deep inside a page.
const env = parseEnv(serverEnvSchema, process.env)
const isDev = process.env.NODE_ENV === 'development'

// Everything is self-hosted (fonts come from next/font). Next.js needs inline scripts/styles for hydration;
// a nonce-based CSP would force dynamic rendering of every page, so 'unsafe-inline' stays for now.
// connect-src includes Supabase only while the browser still calls it directly (remove once the UI only talks to /api/v1).
const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin}${isDev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
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
    poweredByHeader: false,
    // next/image is not used: skip the image optimizer endpoint.
    images: { unoptimized: true },
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }]
    }
}

export default nextConfig
