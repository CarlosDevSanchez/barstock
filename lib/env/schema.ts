import { z } from 'zod'

/** Variables visible to the browser (inlined into the bundle at build time). */
export const clientEnvSchema = z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1)
})

/** Server variables: adds secrets that must NEVER carry the NEXT_PUBLIC_ prefix. */
export const serverEnvSchema = clientEnvSchema.extend({
    // Only used to invite users (auth.admin). Bypasses RLS: do not use it for anything else.
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    // Public URL of the app; base for invitation and password-reset links.
    APP_URL: z.url()
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
