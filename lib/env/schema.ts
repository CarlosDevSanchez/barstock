import { z } from 'zod'

/** Variables visible to the browser (inlined into the bundle at build time). */
export const clientEnvSchema = z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1)
})

const R2_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const

/** Server variables: adds secrets that must NEVER carry the NEXT_PUBLIC_ prefix. */
export const serverEnvSchema = clientEnvSchema
    .extend({
        // Only used to invite users (auth.admin). Bypasses RLS: do not use it for anything else.
        SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
        // Public URL of the app; base for invitation and password-reset links.
        APP_URL: z.url(),
        // Cloudflare R2 (product and receipt-logo image storage, lib/server/storage.ts). Optional AS A GROUP: the
        // bucket is provisioned later, so `next build`/CI must keep working with none of these set. When absent,
        // the image endpoints answer 503 storage_not_configured and the UI hides the image picker.
        R2_ACCOUNT_ID: z.string().min(1).optional(),
        R2_ACCESS_KEY_ID: z.string().min(1).optional(),
        R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
        R2_BUCKET: z.string().min(1).optional(),
        // LOCAL DEV ONLY escape hatch: points lib/server/storage.ts at an S3-compatible endpoint (e.g. the MinIO
        // container from docker-compose.r2.yml) instead of the real https://<account>.r2.cloudflarestorage.com.
        // Independent of the four R2_* vars above (still required, even if their values are dummy local ones) and
        // never set in production. Never documented as required; leave unset to use real R2.
        R2_ENDPOINT_OVERRIDE: z.string().url().optional(),
        // LOCAL DEV ONLY, independent of R2_ENDPOINT_OVERRIDE: the host the BROWSER uses for signed GET URLs
        // (e.g. http://localhost:9000), as opposed to the Docker-internal host (http://r2:9000) the app container
        // uses to reach MinIO for uploads/deletes. Falls back to R2_ENDPOINT_OVERRIDE when unset (same host works
        // for both when the app itself runs outside Docker, e.g. `bun run dev` on the host).
        R2_PUBLIC_ENDPOINT_OVERRIDE: z.string().url().optional()
    })
    .superRefine((value, ctx) => {
        const present = R2_KEYS.filter(key => value[key] !== undefined)
        if (present.length === 0 || present.length === R2_KEYS.length) return
        for (const key of R2_KEYS) {
            if (value[key] === undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: [key],
                    message: 'All four R2 variables must be set together, or none'
                })
            }
        }
    })

export type ClientEnv = z.infer<typeof clientEnvSchema>
export type ServerEnv = z.infer<typeof serverEnvSchema>

export class EnvError extends Error {
    constructor(readonly problems: readonly string[]) {
        super(
            `Invalid environment variables:\n${problems.map(problem => `  - ${problem}`).join('\n')}\n` +
                'Copy .env.example to .env.local and fill in the missing values.'
        )
        this.name = 'EnvError'
    }
}

/**
 * Validates `source` against `schema` and throws an `EnvError` naming every missing or invalid variable.
 * Empty strings count as missing (a `.env` line like `VAR=` must not pass as defined).
 */
export function parseEnv<T extends z.ZodObject>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
    const cleaned: Record<string, string | undefined> = {}
    for (const key of Object.keys(schema.shape)) {
        const value = source[key]
        cleaned[key] = value === '' ? undefined : value
    }

    const result = schema.safeParse(cleaned)
    if (result.success) return result.data

    const problems = result.error.issues.map(issue => {
        const name = issue.path.join('.')
        return cleaned[name] === undefined ? `${name}: missing` : `${name}: ${issue.message}`
    })
    throw new EnvError(problems)
}
