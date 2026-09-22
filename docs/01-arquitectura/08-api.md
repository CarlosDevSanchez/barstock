# API `/api/v1` y capa de servidor

> **Estado: implementado** (etapa 1, Paso 5). Confianza: **[Verificado]** con `bun test` (unidad), pruebas manuales de cada endpoint por rol
> contra Supabase local (incluido el flujo de invitación con el correo real de Mailpit) y un recorrido completo en Chromium. Las pruebas
> automáticas de integración/e2e llegan en el Paso 6.

## Principio

El navegador **no habla con Supabase**: solo con `/api/v1`. La autorización tiene dos capas independientes: el rol se comprueba en `route()`
y **RLS** decide los datos con el JWT del usuario. El lint lo impone: `no-restricted-imports` prohíbe `@supabase/*`, `@/lib/supabase` y
`@/lib/server/**` en `app/(auth)`, `app/(dashboard)` y `components/`. Única excepción: `app/(dashboard)/layout.tsx`, que es un Server Component
(lee sesión y ajustes en el servidor y los pasa a `AppShell`).

```
navegador ── lib/api/* (fetch) ──▶ proxy.ts ──▶ app/api/v1/**/route.ts
                                                     │  route({ role, body, query, params, handler })
                                                     ▼
                                     lib/server/services/*  (reciben el cliente del request)
                                                     ▼
                                  Supabase con el JWT del usuario ⇒ RLS + RPC transaccionales
```

## Piezas

| Archivo | Función |
|---|---|
| `proxy.ts` | Refresca la sesión (cookies) y valida el JWT; sin sesión: páginas → `307 /login?next=…`, `/api/*` → `401` JSON. Guarda por rol en `/settings`, `/users` (admin) y `/reports`, `/suppliers` (gerente). **Guarda de UX**, no la frontera de seguridad. Públicas: `/login`, `/forgot-password`, `/reset-password`, `/auth/confirm`, `/api/v1/auth/*` |
| `lib/server/http.ts` | `route()` (autenticada) y `publicRoute()`. Orden: comprobación de origen → sesión y rol → validación zod → handler → envoltorio JSON |
| `lib/server/auth.ts` | `loadSession()`, `getSession()`, `requireUser()`, `requireRole(min)`. Usa `auth.getUser()` (valida el JWT) y lee el rol de `profiles` **en cada petición**; un usuario inactivo cuenta como no autenticado |
| `lib/server/errors.ts` | `AppError`, mapeo de códigos de Postgres, `assertNoError()` |
| `lib/server/supabase.ts` | Cliente tipado (`SupabaseClient<Database>`) con las cookies del request: aplica RLS. Es el único que reciben los servicios |
| `lib/server/supabase-admin.ts` | Cliente `service_role`. **Solo** lo usa `services/users.ts` para invitar |
| `lib/server/services/*` | `products`, `categories`, `customers`, `suppliers`, `inventory`, `orders`, `sales`, `reports`, `settings`, `users`, `auth` |
| `lib/validation/*` | Esquemas zod compartidos cliente/servidor (`common`, `resources`, `reports`) |
| `lib/api/*` | Cliente `fetch` tipado (`client.ts`, `ApiError`, `errorMessage`) y un módulo por recurso |
| `app/auth/confirm/route.ts` | Destino de los correos de invitación y recuperación: `verifyOtp(token_hash)` en el servidor → cookie de sesión → `/reset-password` |
| `supabase/templates/*.html` | Plantillas de esos correos (en un proyecto hospedado hay que pegarlas en *Authentication → Email Templates*) |

## Endpoints

Todos con `route()`; listas paginadas `?page&pageSize&q` (`pageSize` ≤ 100, por defecto 25). "Rol mínimo": `cashier` < `manager` < `admin`.

| Recurso | Métodos | Rol mínimo | Notas |
|---|---|---|---|
| `auth/login` | POST | público | Mismo mensaje para email inexistente y clave errónea; 403 si la cuenta está inactiva; 429 con límite de intentos |
| `auth/logout` | POST | público | Idempotente |
| `auth/password/forgot` | POST | público | **Siempre 204** (no revela si el email existe) |
| `auth/password/reset` | POST | cajero | Requiere la sesión creada por `/auth/confirm` |
| `me` | GET · PATCH | cajero | GET: sesión actual. PATCH `{ locale: 'es' \| 'en' }` → `profiles.locale` + cookie `NEXT_LOCALE` |
| `products`, `products/[id]` | GET · POST/PATCH/DELETE | cajero · gerente | `?category_id&active&ids`; DELETE = borrado lógico. Lista con `stock` |
| `categories`, `categories/[id]` | GET · POST/PATCH/DELETE | cajero · gerente | Lista con `product_count`; DELETE falla con 409 si tiene productos |
| `customers`, `customers/[id]` | GET/POST/PATCH | cajero | `total_spent`/`loyalty_points` no son escribibles |
| `suppliers`, `suppliers/[id]` | GET/POST/PATCH | gerente | |
| `inventory` | GET | cajero | `?low` y `summary` (`total_units`, `item_count`, `low_stock_count`, `stock_value`) sobre todo el conjunto filtrado |
| `inventory/[id]/adjust` | POST | gerente | RPC `adjust_inventory`; `{ delta, reason }` |
| `sales` | POST | cajero | RPC `create_sale`; solo ids y cantidades; devuelve la orden con totales calculados por la BD |
| `orders`, `orders/[id]` | GET | cajero | Cajero: solo las suyas (RLS). `?status&customer_id&from&to&q` (q = número de orden) |
| `orders/[id]/refund` | POST | gerente | RPC `refund_order`; `{ reason }`; idempotente |
| `dashboard` | GET | cajero | RPC `dashboard_summary`; el cajero ve solo sus ventas |
| `reports` | GET | gerente | RPC `sales_report`; `?from&to` (≤ 366 días) |
| `settings` | GET · PATCH | cajero · admin | Una fila JSONB por clave; valores inválidos caen al valor por defecto |
| `users` | GET | admin | |
| `users/invite` | POST | admin | `inviteUserByEmail` + rol en `app_metadata` (un trigger lo copia al perfil y lo activa); si falla la asignación de rol se borra el usuario |
| `users/[id]` | PATCH | admin | `{ role?, is_active? }`; no se puede uno desactivar ni quitarse el rol de admin; el trigger protege al último admin |

## Contrato

Éxito: `{ "data": … }`. Listas: `{ "data": [...], "page", "pageSize", "total", "summary"? }`. `204` sin cuerpo. Todas las respuestas llevan
`Cache-Control: no-store`. Error: `{ "error": { "code", "message", "details"? } }`.

| Estado | `code` | Cuándo |
|---|---|---|
| 400 | `bad_request` | JSON mal formado; valor con formato inválido para Postgres (`22P02`) |
| 401 | `unauthorized` | Sin sesión, sesión inválida, perfil ausente/inválido o usuario inactivo |
| 403 | `forbidden` | Rol insuficiente; RLS (`42501`); escritura desde otro origen; cuenta desactivada en el login |
| 404 | `not_found` | Recurso inexistente o invisible para el rol (`PGRST116`, `P0002`, 0 filas) |
| 409 | `conflict` | `UNIQUE` (`23505`) o clave foránea (`23503`); email de usuario ya existente |
| 422 | `validation_failed` | Falla zod; `details` = `[{ path, message }]` |
| 422 | `unprocessable` | `CHECK`/`NOT NULL` (`23514`, `23502`) o `RAISE EXCEPTION` de un RPC (`P0001`, p. ej. `Insufficient stock for "Wireless Mouse"`) |
| 429 | `too_many_requests` | Límite de intentos de Supabase Auth |
| 500 | `internal_error` | Cualquier otra cosa; el detalle solo va al log del servidor |

**Los mensajes crudos de Postgres nunca llegan al cliente**, con una excepción deliberada: `P0001`/`P0002`, escritos por nosotros en los RPC.

## Cómo añadir un recurso

1. Migración + `bun run db:types` (tabla, RLS, y RPC si escribe en varias tablas).
2. Esquemas en `lib/validation/resources.ts`: solo las columnas escribibles, `''` → `null`, **sin `.default()`** (rompe el `PATCH`).
3. `lib/server/services/<recurso>.ts`: reciben el cliente del request, comprueban `{ error }` con `assertNoError`, y tratan "0 filas" como 404
   (RLS no lanza error al bloquear un `UPDATE`/`DELETE`).
4. `app/api/v1/<recurso>/route.ts` con `route({ role, body, query, params, handler })`.
5. `lib/api/<recurso>.ts` y la página, con `useApiQuery` (lectura) y `react-hook-form` + el mismo esquema (escritura).
6. Pruebas (unidad del esquema, integración del handler, RLS por rol) y documentar el endpoint aquí.

## Trampas de seguridad y de tipos

| Tema | Tratamiento |
|---|---|
| CSRF con sesión por cookie | `route()` rechaza escrituras cuyo `Origin` no coincide con el `Host` servido (`x-forwarded-host` detrás de proxy). Sin `Origin` (clientes no navegador) se permite |
| Asignación masiva | Los esquemas solo listan columnas escribibles; zod descarta el resto |
| `''` hacia columnas opcionales/`UNIQUE` | Normalizado a `null` |
| Inputs numéricos | `<input type="number">` entrega **string**: los esquemas de dinero, cantidad y `delta` convierten (`toNumber`) y **nunca** interpretan `''` como 0 |
| Dinero | Redondeo a la escala de la moneda (`money_scale` / `currencyDecimals`: 0 en COP, 2 en USD) y rechazo de más precisión; tasa de impuesto como fracción `0–1` en la API y como porcentaje en los formularios (`taxRatePercent`) |
| Inyección en filtros PostgREST | `sanitizeSearch()` elimina `, ( ) " \ % * _` antes de armar `.or()`/`ilike` |
| UUID | `z.guid()`, no `z.uuid()`: zod 4 exige bits de versión RFC y rechaza los ids del seed (`aaaaaaaa-…`) que Postgres acepta |
| Tipos de `select` | supabase-js infiere el resultado del **literal** del `select`; concatenar strings (`+`) lo degrada a `string` |
| Envío antes de hidratar | Un formulario enviado antes de que React cargue hace un `GET` nativo y **deja la contraseña en la URL**. Los de auth usan `method="post"` y el botón espera a `useHydrated()` |
| `next dev` y `AGENTS.md` | Next 16.3 añade un bloque a `AGENTS.md`/`CLAUDE.md` en cada arranque; `agentRules: false` en `next.config.ts` lo desactiva |

## Cliente (UI)

- `hooks/use-api-query.ts`: lectura con cancelación, ignora respuestas obsoletas, conserva los datos previos mientras carga y nunca llama a
  `setState` de forma síncrona en el efecto (regla `react-hooks/set-state-in-effect`).
- `components/session-provider.tsx`: `useSession()` (usuario y ajustes) y `useMoney()` (moneda de los ajustes). El layout servidor los rellena;
  `router.refresh()` los actualiza tras guardar `/settings`.
- `stores/cart.ts`: **solo ids, cantidades y descuentos** (sin precios ni totales). El POS consulta precio y stock en vivo con `products?ids=` y
  muestra una **vista previa** (`lib/cart-preview.ts`, aritmética entera); el total que cuenta es el que devuelve `POST /sales`. Se vacía en el logout.
- Formularios: `react-hook-form` + `zodResolver` con el **mismo esquema** que valida el servidor (`components/form-fields.tsx`).
- Confirmaciones: `ConfirmDialog` (AlertDialog) en lugar de `window.confirm()`.

## Límites conocidos

- El selector de clientes del POS carga los 100 primeros (sin búsqueda); el catálogo del POS muestra hasta 100 productos (avisa cuando hay más).
- La búsqueda de órdenes es solo por número (antes también por nombre de cliente).
- El enlace de invitación es de un solo uso: un escáner de correo que lo abra antes lo consume (el usuario pide otro).
- El límite de intentos de login es el de Supabase Auth; no hay uno propio.
