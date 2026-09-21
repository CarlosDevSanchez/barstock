import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const supabaseAndServerOnly = [
    {
        group: ['@supabase/*', '@/lib/supabase', '@/lib/supabase/**'],
        message: 'El navegador no habla con Supabase: usa lib/api/* (la lógica vive en app/api/v1 y lib/server).'
    },
    {
        group: ['@/lib/server', '@/lib/server/**'],
        message: 'lib/server es solo para el servidor: llámalo desde un Route Handler o un Server Component.'
    }
]

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        files: ['**/*.{ts,tsx,mts}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
        },
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
        }
    },
    {
        // La lógica de negocio va en la API: las capas de UI no importan Supabase ni lib/server.
        files: ['app/(auth)/**/*.{ts,tsx}', 'app/(dashboard)/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': ['error', { patterns: supabaseAndServerOnly }]
        }
    },
    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'coverage/**',
        'playwright-report/**',
        'test-results/**',
        'supabase/legacy/**',
        '.code-review-graph/**',
        'next-env.d.ts'
    ])
])

export default eslintConfig
