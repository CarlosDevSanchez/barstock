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

`agentRules: false` (evita que `next dev` escriba en `AGENTS.md`/`CLAUDE.md`), `poweredByHeader: false`,
`images: { unoptimized: true }` (no se usa `next/image`). `headers()` añade cabeceras de seguridad (CSP, `X-Frame-Options`,
HSTS…) a todas las rutas y, aparte, `Cache-Control: no-cache` + `Service-Worker-Allowed: /` solo a `/sw.js` (ver
[PWA y offline](09-pwa-offline.md)): el service worker no puede quedar cacheado por el navegador o una versión nueva
nunca se descargaría. La CSP incluye `worker-src`/`manifest-src` para el service worker y el manifest, y los hosts de
R2/MinIO en `connect-src` (los `fetch` del propio service worker se rigen por esa directiva, igual que los del navegador).

## Otros archivos

| Archivo | Contenido |
|---|---|
| `postcss.config.mjs` | Plugin `@tailwindcss/postcss` |
| `components.json` | Configuración de shadcn (ver [UI](06-ui-y-diseno.md)) |
| `.gitignore` | Ignora `node_modules`, `.next`, `.env*`, `.vercel`, `*.tsbuildinfo`, `next-env.d.ts`. **`.env*` también ignora un futuro `.env.example`**; añadir `!.env.example` |
| `.claude/settings.local.json` | `enabledMcpjsonServers: ["code-review-graph"]`, `enableAllProjectMcpServers: true` |
| `.code-review-graph/` | Base de datos del grafo de código (generada; ver `CLAUDE.md`) |

## CI y actualizaciones (etapa 1, Paso 7)

| Pieza | Archivo | Qué hace |
|---|---|---|
| CI | `.github/workflows/ci.yml` | En cada PR y push a `main`: `bun install --frozen-lockfile` → `format:check` → `lint` → `typecheck` → `bun audit --audit-level=high` → `supabase start` (BD desde cero: migraciones + seed) → `test:coverage` (≥ 80 % en `lib/server` y `lib/validation`) → `test:components` → `build` → Playwright |
| Dependabot | `.github/dependabot.yml` | Semanal, para `bun` (agrupado: next-react, radix, tailwind, supabase, formularios, testing, lint) y para las propias Actions. Ignora los saltos mayores de `typescript`, `eslint`, `lucide-react` y `@types/node` |

Decisiones del workflow:

- **Sin secretos.** Solo usa `contents: read` y un Supabase local efímero dentro del job; las claves que imprime son las públicas de demo.
- **Acciones fijadas por commit** (`uses: …@<sha> # v4`), no por etiqueta: una etiqueta movida no puede cambiar lo que se ejecuta. Dependabot las actualiza.
- **Supabase reducido**: `supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta`. Solo se levantan
  base de datos, Auth, PostgREST, la pasarela y Mailpit (los correos de invitación/recuperación); se comprobó que las pruebas pasan así.
- **`bun-version: 1.4.1`** duplica `packageManager` de `package.json`: cambiar los dos a la vez. Node sale de `.nvmrc`.
- **Un solo job** (no varios en paralelo): cada job repetiría `supabase start` (2–4 min de descarga de imágenes) y la instalación.
- Al fallar se suben `playwright-report/`, `test-results/` y `coverage/` como artefacto (7 días).
- `bun audit` puede ponerse en rojo el día que se publique un aviso nuevo: es intencionado.

**Para que sea obligatorio** (no depende del repositorio, es configuración de GitHub): *Settings → Branches → Branch protection rule* sobre `main`, marcando
"Require status checks to pass" con el check `check` y "Require branches to be up to date". Sin esa regla el CI informa pero no impide el merge.

**Verificación.** `actionlint` sin hallazgos y una **emulación local del job completo** (BD desde cero, mismos servicios excluidos, entorno mínimo sin
`.env.local`): todos los pasos en verde. Pendiente: la primera ejecución real en GitHub (runner Linux/x64 frente a macOS/arm64 local).

## Lo que no existe

| Herramienta | Estado | Recomendación |
|---|---|---|
| Husky / lint-staged | Ninguno | Opcional (el CI ya bloquea lo que no cumple) |
| Dockerfile / manifiestos | Ninguno | No necesarios si se despliega en Vercel |
| `vercel.json` | Ninguno | Solo si hay configuración especial |
| Monitoreo (Sentry) | Ninguno | Añadir en Fase 3 |
| Migraciones (`supabase/migrations`) | Ninguno | Adoptar Supabase CLI |

## Despliegue

El README sugiere Vercel (`bun run build` + `vercel --prod`). No hay archivo de configuración ni
documentación de entornos (dev/staging/prod). Las variables `NEXT_PUBLIC_*` deben definirse en el panel
de Vercel **antes** del primer build por el defecto H5. Ver [variables de entorno](../05-guias/variables-de-entorno.md).
