# Configuración y tooling

> Base: commit `54962b9` · Confianza: **[Verificado]**

## Scripts (`package.json`)

| Script | Comando | Notas |
|---|---|---|
| `dev` | `next dev` | Turbopack por defecto en Next 16 |
| `build` | `next build` | **Falla sin variables de entorno** ([H5](../04-auditoria/hallazgos/H5-build-sin-env.md)) |
| `start` | `next start` | |
| `lint` | `eslint` | **Falla hoy**: 32 errores, 10 warnings ([lint-y-tipos](../04-auditoria/lint-y-tipos.md)) |

No existen `test`, `typecheck` ni `format`. `typecheck` se ejecuta con `./node_modules/.bin/tsc --noEmit`.

> **Cuidado con `npx tsc`:** si `typescript` no está instalado, `npx tsc` descarga un paquete distinto
> llamado `tsc` (obsoleto) que solo imprime un aviso. Instalar dependencias primero (`bun install`) y usar
> `bun run typecheck`.

## TypeScript — `tsconfig.json`

- `strict: true` (incluye `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`).
- `target: ES2017`, `module: esnext`, `moduleResolution: bundler`, `jsx: react-jsx`, `isolatedModules`, `noEmit`.
- `allowJs: true` (no hay `.js` de aplicación), `skipLibCheck: true`, `incremental: true`.
- Alias `@/*` → `./*`.
- `include` cubre `**/*.ts`, `**/*.tsx`, `.next/types/**` y `.next/dev/types/**`.
- Falta `noUncheckedIndexedAccess` (recomendable) y `noUnusedLocals` (lo cubre ESLint).
- **Resultado:** `tsc --noEmit` termina sin errores.

## ESLint — `eslint.config.mjs`

Flat config de ESLint 9 con `eslint-config-next/core-web-vitals` y `eslint-config-next/typescript`,
ignorando `.next/**`, `out/**`, `build/**`, `next-env.d.ts`. Las reglas de `react-hooks` (incluida
`react-hooks/immutability`, nueva en el plugin) y `@typescript-eslint/no-explicit-any` generan los errores actuales.
Sin Prettier, sin `lint-staged`, sin hooks de git.

## Next.js — `next.config.ts`

Vacío (`{}`). Sin `headers()`, `images`, `redirects`, `poweredByHeader`, `output`, ni
`reactStrictMode` explícito. Ver [medios y bajos](../04-auditoria/hallazgos/medios-y-bajos.md) para los
headers de seguridad recomendados.

## Otros archivos

| Archivo | Contenido |
|---|---|
| `postcss.config.mjs` | Plugin `@tailwindcss/postcss` |
| `components.json` | Configuración de shadcn (ver [UI](06-ui-y-diseno.md)) |
| `.gitignore` | Ignora `node_modules`, `.next`, `.env*`, `.vercel`, `*.tsbuildinfo`, `next-env.d.ts`. **`.env*` también ignora un futuro `.env.example`**; añadir `!.env.example` |
| `.claude/settings.local.json` | `enabledMcpjsonServers: ["code-review-graph"]`, `enableAllProjectMcpServers: true` |
| `.code-review-graph/` | Base de datos del grafo de código (generada; ver `CLAUDE.md`) |

## Lo que no existe

| Herramienta | Estado | Recomendación |
|---|---|---|
| Tests (Vitest/Jest/Playwright) | Ninguno | Empezar por la lógica de venta (ver [plan](../06-roadmap/plan-de-remediacion.md)) |
| CI (`.github/workflows`) | Ninguno | `lint`, `tsc`, `audit`, `build`, tests |
| Prettier / EditorConfig | Ninguno | Fijar 4 espacios, sin punto y coma, comillas simples (estilo dominante) |
| Husky / lint-staged | Ninguno | Opcional |
| Dependabot / Renovate | Ninguno | Activar |
| Dockerfile / manifiestos | Ninguno | No necesarios si se despliega en Vercel |
| `vercel.json` | Ninguno | Solo si hay configuración especial |
| Monitoreo (Sentry) | Ninguno | Añadir en Fase 3 |
| Migraciones (`supabase/migrations`) | Ninguno | Adoptar Supabase CLI |

## Despliegue

El README sugiere Vercel (`bun run build` + `vercel --prod`). No hay archivo de configuración ni
documentación de entornos (dev/staging/prod). Las variables `NEXT_PUBLIC_*` deben definirse en el panel
de Vercel **antes** del primer build por el defecto H5. Ver [variables de entorno](../05-guias/variables-de-entorno.md).
