# Pruebas

> Etapa 1, Pasos 6 y 7. Confianza: **[Verificado]** en local. El CI ejecuta todo esto en cada PR ([workflow](../01-arquitectura/07-configuracion-y-tooling.md#ci-y-actualizaciones-etapa-1-paso-7)); su primera ejecución real en GitHub está pendiente.

## Qué hay y qué demuestra cada nivel

| Nivel | Dónde | Herramienta | Necesita BD | Qué cubre |
|---|---|---|---|---|
| Unitarias | `lib/**/*.test.ts`, `stores/*.test.ts`, `test/offline/*.test.ts` | `bun test` | No | Esquemas zod (`''` → `null`, dinero, límites, asignación masiva), `formatMoney`, `previewTotals`, `dateInZone`, roles, validación de entorno, mapeo de errores, `route()` (CSRF, 401/403/422, errores), cliente `fetch`, carrito, degradado offline sin `indexedDB` |
| Componentes | `test/components/*.test.tsx` | `bun test` + happy-dom + Testing Library | No | Carrito del POS, formulario de producto (errores de validación y normalización), navegación por rol, confirmación de borrado |
| API (integración) | `test/integration/{auth,catalog,sales,admin,proxy}.test.ts` | `bun test` | **Sí** (Supabase local) | Cada Route Handler invocado con un `Request` real y la cookie de sesión de un login real, por rol: 401 sin sesión, 403 por rol, 422 por validación, respuesta correcta; `proxy.ts`; flujo de invitación y recuperación con el correo real de Mailpit |
| Seguridad / RLS | `test/integration/rls.test.ts` | `bun test` + supabase-js | **Sí** | Clientes autenticados como cajero, gerente, admin, inactivo y anónimo **sin código de la app por medio** (como un atacante con la clave anónima): escalada de rol, escrituras directas revocadas, matriz de roles, visibilidad de órdenes, trigger de alta, `CHECK`s |
| Reglas de negocio (RPC) | `test/integration/rpc.test.ts` | `bun test` + supabase-js | **Sí** | `create_sale`, `refund_order`, `adjust_inventory`, reportes; **concurrencia** |
| E2E | `e2e/*.e2e.ts` | Playwright (Chromium) | **Sí** + build de producción | Login → venta → el stock baja → reembolso → el stock vuelve; ajuste de stock; roles y redirecciones; escalada desde la consola; invitación, desactivación y recuperar contraseña |

## Cómo ejecutarlas

```bash
bun run db:start                 # una vez (Docker activo): Supabase local
bun run test:unit                # sin BD
bun run test:components          # sin BD (un proceso por archivo, ver más abajo)
bun run test:integration         # requiere db:start
bunx playwright install chromium # una vez
bun run test:e2e                 # compila, arranca `next start` y recorre la app
bun run test                     # unit + components + integration
bun run test:coverage            # unit + integration con cobertura y umbral
```

`bun run check` = typecheck → lint → test → build.

## En CI

`.github/workflows/ci.yml` ejecuta, en este orden, lo que aquí se describe: `test:coverage` (unitarias + integración con el umbral), `test:components`, `build` y
`test:e2e`, contra un Supabase local efímero levantado en el propio job. Para reproducirlo en local sin `.env.local` (que enmascararía variables que falten):
mover `.env.local`, `supabase stop --no-backup && supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta`,
exportar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `MAILPIT_URL` desde `supabase status -o env`, y lanzar los pasos.
Con `CI=true`, Playwright no reutiliza un servidor existente y arranca `bun run start` (el build es un paso anterior).

## Reglas de seguridad de las pruebas

- Las pruebas de integración y e2e **crean usuarios y escriben datos**. `requireLocalSupabase()` **se niega a ejecutarse contra un host que no sea
  `127.0.0.1`/`localhost`** (regla dura 10 de `AGENTS.md`). Con la BD apagada fallan con un mensaje que dice qué hacer.
- Los datos se crean con nombres únicos (`uniq()`); **no se limpian**. `bun run db:reset` vuelve a un estado limpio. Por eso ninguna prueba
  afirma cifras globales de "hoy": los reportes se comprueban con pedidos fechados en un día pasado aleatorio (cifras exactas) y el resto con
  diferencias antes/después.
- Usuarios de prueba (`test/helpers/integration.ts`): `admin|manager|cashier|inactive@barstock.test`. Se crean con la API de administración de Auth y se
  **resetea** su rol, activación y contraseña en cada ejecución. Las pruebas que cambian contraseñas usan usuarios efímeros.

## Cómo está montado

- **Entorno** (`test/setup.ts`, precarga): usa el Supabase local (`supabase status -o env`) si no hay variables reales; si no, valores inertes para que
  los módulos que validan el entorno al importarse carguen en las pruebas puramente unitarias.
- **Handlers sin servidor** (`test/helpers/http.ts`): los handlers leen la sesión con `cookies()` de `next/headers`. El helper lo sustituye por un
  almacén basado en `AsyncLocalStorage`, de modo que cada cliente lleva **su** jar de cookies y varios pueden usarse a la vez. La sesión sale del
  handler real `auth/login` (cookies reales de `@supabase/ssr`).
- **Por qué procesos separados.** `mock.module` de Bun es **global al proceso** y persiste entre archivos: el mock de `@/lib/server/supabase` de
  `http.test.ts` rompería las pruebas de integración que usan el cliente real. Además Testing Library captura `document` al importarse, así que
  cada archivo de componentes necesita su propio proceso (`test:components` los lanza uno a uno). Misma razón: la suite del degradado sin
  `indexedDB` vive en `test/offline/` (fuera de `lib/`), lanzada en un segundo `bun test` tras el batch `lib stores` — si compartiera proceso con
  `outbox.test.ts`/`sync.test.ts`, su `mock.module('@/lib/offline/db')` sustituiría el módulo real (falla cuando el orden es sync → db, como en
  CI Linux). Por la misma razón, `test/integration/notifications-dispatch.test.ts` (`mock.module('resend'|'web-push')`, `dispatchOutbox`
  end-to-end) corre en su **propio** `bun test` separado del resto de `test/integration/`: `test:integration` y `test:coverage` lo excluyen del
  batch principal (`find ... ! -name 'notifications-dispatch.test.ts'`) y lo lanzan aparte; cada uno restaura con `try/finally` cualquier
  `process.env.*` que toque. Consecuencia: no se usa `coverageThreshold` de `bunfig.toml` (juzgaría cada proceso por separado) y
  `scripts/coverage-check.ts` fusiona tres informes lcov, no dos.
- **Bun en CI.** `supabase/setup-cli` reinstala Bun según su propio `.bun-version` y lo pone delante en `PATH`; el workflow vuelve a pinnear
  1.4.1 justo después para que `test:coverage` / e2e no corran con una versión distinta a `packageManager`.
- **Cobertura** (`scripts/coverage-check.ts`): fusiona los informes lcov de unitarias e integración y exige **≥ 80 % de líneas** en `lib/server/**` y
  `lib/validation/**`; un archivo que ninguna prueba carga cuenta como fallo (no desaparece del informe). Hoy: `lib/server` 96,8 %, `lib/validation` 99,1 %.
- **Nomenclatura E2E**: `*.e2e.ts`, no `*.spec.ts`, porque `bun test` recoge los `.spec.` y los ejecutaría como unitarios.

## Pruebas de concurrencia: por qué son así

Una carrera se puede colar sin ser detectada. Se comprobó **rompiendo a propósito** cada protección y viendo que la prueba falla:

| Protección quitada (temporalmente) | Prueba que la detecta |
|---|---|
| `FOR UPDATE` en `refund_order` | 30 rondas × 8 reembolsos simultáneos: 31 pedidos con stock duplicado. **Con una sola ráfaga de 10 la carrera no se producía y la prueba pasaba sin el bloqueo**: por eso son 30 rondas |
| Orden de las líneas en `create_sale` (anti-deadlock) | 24 ventas con los mismos dos productos en orden inverso: falla por deadlock |
| Guarda `quantity >= n` del `UPDATE` de stock | Dos ventas de la última unidad |
| `REVOKE`/políticas de escritura sobre `orders` | `rls.test.ts` (3 roles) |
| Trigger `protect_profile_columns` | Escalada de rol de un cajero |
| `for update skip locked` en `_claim_outbox` | `test/integration/outbox-claim-pg.test.ts`, ×20: dos conexiones **Postgres reales** (`Bun.SQL`, no supabase-js) donde una mantiene su transacción abierta sin `COMMIT` mientras la otra reclama — el escenario que dos llamadas RPC vía supabase-js no pueden ejercitar, porque cada una hace `commit` antes de que la otra empiece. Sin el `skip locked` (o con un `for update` a secas), ambas conexiones esperarían la misma fila en vez de repartírselas |

Para repetir el ejercicio: aplicar la mutación con `docker exec supabase_db_barstock psql …` (p. ej. `pg_get_functiondef` + `sed`), ejecutar la prueba y
volver al estado sano con `bun run db:reset`.

## Trampas que las pruebas ya destaparon

- `<input type="number">` entrega un **string**: `inventoryAdjustSchema.delta` era `z.number()` y el ajuste de stock fallaba en el navegador (las pruebas con
  números no lo veían). Todos los esquemas numéricos convierten con `toNumber` y nunca interpretan `''` como 0.
- Un usuario **desactivado con sesión válida** entraba en un **bucle de redirecciones** (layout → `/login` → proxy → `/dashboard` → …). `proxy.ts` ahora cierra
  la sesión en `/login` si el perfil no está activo.
- El POS dejaba cobrar con un producto **sin stock** o **borrado** en el carrito; ahora bloquea el cobro y avisa en la línea.
- Los ids del seed (`aaaaaaaa-…`) no son UUID RFC 4122 válidos para `z.uuid()` de zod 4: se usa `z.guid()`.
- Un formulario enviado **antes de hidratar** hace un `GET` nativo y deja la contraseña en la URL: el botón de los formularios de auth espera a `useHydrated()`.
- `getByText('Total')` en Playwright casa también con "Subtotal": usar `{ exact: true }`.
- En las tablas paginadas **en el cliente** (p. ej. `/receivables`), comprobar una fila antes de que cargue la lista la da por ausente: el
  helper `receivableRow` (`e2e/cash-and-receivables.e2e.ts`) espera el texto «Showing X–Y of N» antes de recorrer páginas. Sin esa espera,
  con 11 filas y la buscada en la página 1, saltaba a la página 2 (fallo del CI en el PR #13).
- `page.route` **no ve** los `fetch` que atiende el service worker (build de producción): para interceptarlos, crear el contexto con
  `serviceWorkers: 'block'`.

## Cómo añadir pruebas a un recurso nuevo

1. Esquema: caso válido, `''` → `null`, límites, claves ajenas descartadas y `PATCH` parcial (`lib/validation/resources.test.ts`).
2. Handler: sin sesión (401), rol insuficiente (403), validación (422), caso feliz y "no existe" (404) en `test/integration/`.
3. Si hay tabla nueva: prueba de RLS en `rls.test.ts` (matriz de roles, 0 filas silenciosas en `UPDATE`/`DELETE`, columnas derivadas).
4. Si hay RPC: reglas de negocio, atomicidad (un fallo no deja nada escrito) y, si toca stock o dinero, una prueba de concurrencia **verificada rompiendo la protección**.
5. Si hay flujo de usuario nuevo: un e2e por el camino feliz y por el permiso denegado.
