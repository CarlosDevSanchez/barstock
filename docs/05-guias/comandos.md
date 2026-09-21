# Comandos de referencia

> Gestor de paquetes: **Bun** (`bun@1.4.1`, fijado en `package.json`). Todos los comandos se ejecutan desde la raíz del repositorio.

## Scripts del proyecto

| Comando | Qué hace | Estado hoy |
|---|---|---|
| `bun install --frozen-lockfile` | Instala exactamente lo de `bun.lock` (falla si el lockfile no cuadra con `package.json`) | ✅ |
| `bun run dev` | Servidor de desarrollo (Turbopack) en `:3000` | ✅ |
| `bun run build` | Build de producción | ✅ con las 4 variables de `.env.example`; sin ellas falla nombrando cuál ([H5](../04-auditoria/hallazgos/H5-build-sin-env.md)) |
| `bun run start` | Sirve el build | ✅ tras un build correcto |
| `bun run lint` | ESLint (`--max-warnings 0`) | ❌ errores existentes en las páginas cliente, que se eliminan con el refactor a API ([lint](../04-auditoria/lint-y-tipos.md)) |
| `bun run typecheck` | `tsc --noEmit` con `strict` + `noUncheckedIndexedAccess` | ✅ |
| `bun run format` / `format:check` | Prettier (4 espacios, sin `;`, comillas simples) | — |
| `bun run test` · `test:unit` · `test:integration` · `test:e2e` | Tests (`bun test`, Playwright para e2e) | ✅ unitarios de `lib/env`; el resto llega en el Paso 6 |
| `bun run audit` | `bun audit` | ✅ limpio tras Next 16.3.5 ([C3](../04-auditoria/hallazgos/C3-dependencias-vulnerables.md)) |
| `bun run db:start` · `db:reset` · `db:types` | Supabase CLI local | — (requiere Docker y Supabase CLI) |
| `bun run check` | typecheck → lint → test → build | — |

## Verificaciones adicionales

| Comando | Para qué |
|---|---|
| `bun run typecheck` | Comprobar tipos (usa el `tsc` local, no descarga nada) |
| `bun run lint -- --fix` | Corregir lo autocorregible |
| `bun audit --audit-level=high` | Vulnerabilidades ([C3](../04-auditoria/hallazgos/C3-dependencias-vulnerables.md)) |
| `bun outdated` | Paquetes desactualizados |
| `bun pm untrusted` | Scripts de instalación bloqueados (Bun no ejecuta `postinstall` por defecto; `trustedDependencies` está vacío) |
| `git status` tras un build | Confirmar que no se ensucia el árbol (`.next/` está ignorado) |

## Lista de comprobación antes de un PR

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun audit --audit-level=high
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... bun run build
```

Y, si se tocó la base de datos: aplicar la migración en un proyecto de **staging**, ejecutar las pruebas SQL de
políticas y actualizar [`docs/02-base-de-datos/`](../02-base-de-datos/).

## Supabase CLI (propuesto; aún no configurado)

```bash
supabase init                                   # crea supabase/config.toml
supabase link --project-ref <ref>               # enlaza con el proyecto remoto
supabase db pull                                # captura el esquema real como primera migración
supabase migration new <tema>                   # nueva migración con timestamp
supabase db push                                # aplica migraciones al remoto
supabase gen types typescript --linked > types/database.ts
```

## Consultas SQL de diagnóstico (SQL Editor)

Ver [RLS](../02-base-de-datos/03-rls-y-politicas.md#cómo-auditar-el-estado-real-ejecutar-en-el-sql-editor-de-supabase),
[índices](../02-base-de-datos/05-indices-y-constraints.md) y las consultas de integridad de
[verificar-checkout](verificar-checkout.md#consultas-de-integridad).

## Grafo de código (`code-review-graph`, MCP)

Configurado en `.claude/settings.local.json`; los agentes lo usan antes de leer archivos (ver `CLAUDE.md`).
Reconstrucción completa: herramienta MCP `build_or_update_graph_tool` con `full_rebuild: true`.
Última construcción documentada: 48 archivos, 259 nodos, 2036 aristas, 19 comunidades, 52 flujos.

## Trampas conocidas

- `npx tsc` / `npx eslint` / `bunx tsc` sin dependencias instaladas descargan otro paquete (`tsc`, obsoleto y sin relación con
  TypeScript) o una versión ajena al proyecto. Instalar primero con `bun install` y usar los scripts (`bun run typecheck`, `bun run lint`).
- **Todas** las dependencias están fijadas a versión exacta (`bunfig.toml` → `[install] exact = true`): `bun update` no las mueve;
  usar `bun add <paquete>@<versión>`. Dependabot propone las actualizaciones.
- Bun no ejecuta scripts de ciclo de vida de las dependencias. Si un paquete nuevo lo necesita, añadirlo a `trustedDependencies`
  con justificación. Hoy solo `unrs-resolver` queda bloqueado y no hace falta (ESLint funciona; `sharp` usa binarios precompilados).
- `package-lock.json` ya no existe; el lockfile es `bun.lock` (texto).
- En zsh, los globs sin comillas (`--include=*.tsx`) fallan con `no matches found`; ponerlos entre comillas.
