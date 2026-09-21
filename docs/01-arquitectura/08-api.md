# API `/api/v1` y capa de servidor

> **Estado: en construcción (etapa 1, Paso 5).** Está hecha y probada la **base** (envoltorio `route()`, errores, validación, cliente
> del navegador y `proxy.ts`). **Faltan** los servicios por recurso, los Route Handlers y el refactor de las páginas: dependen de las
> migraciones de los Pasos 3–4 (tipos generados `types/database.ts` y RPC `create_sale`/`refund_order`/`adjust_inventory`).
> Confianza: **[Verificado]** para lo construido (`bun test`, build y peticiones sin sesión contra `next start`); el resto es diseño.

## Principio

El navegador **no habla con Supabase**: solo con `/api/v1`. La lógica de negocio vive en el servidor y la autorización en dos capas
independientes: el rol se comprueba en `route()` y **RLS** decide los datos con el JWT del usuario. El lint lo impone
(`no-restricted-imports` en `app/(auth)`, `app/(dashboard)` y `components/`).

```
navegador ── lib/api/* (fetch) ──▶ proxy.ts ──▶ app/api/v1/**/route.ts
                                                     │  route({ role, body, query, params, handler })
                                                     ▼
                                     lib/server/services/*  (reciben el cliente del request)
                                                     ▼
                                  Supabase con el JWT del usuario ⇒ RLS + RPC transaccionales
```

## Piezas construidas

| Archivo | Función |
|---|---|
| `proxy.ts` | Refresca la sesión (cookies), valida el JWT con Supabase Auth; sin sesión: páginas → `307 /login?next=…`, `/api/*` → `401` JSON. Guarda por rol en `/settings`, `/users` (admin) y `/reports`, `/suppliers` (gerente). **Es una guarda de UX**, no la frontera de seguridad |
| `lib/server/http.ts` | `route()` (autenticada) y `publicRoute()` (login, olvidé contraseña). Orden: comprobación de origen → sesión y rol → validación zod → handler → envoltorio JSON |
| `lib/server/auth.ts` | `getSession()`, `requireUser()`, `requireRole(min)`. Usa `auth.getUser()` (valida el JWT, a diferencia de `getSession()` de supabase-js) y lee el rol de `profiles` **en cada petición**; un usuario inactivo cuenta como no autenticado |
| `lib/server/errors.ts` | `AppError`, mapeo de códigos de Postgres, `assertNoError()` |
| `lib/server/supabase.ts` | Cliente con las cookies del request (aplica RLS). Es el único que reciben los servicios |
| `lib/server/supabase-admin.ts` | Cliente `service_role`. **Solo** para `auth.admin` (invitar usuarios) |
| `lib/validation/*` | Esquemas zod compartidos cliente/servidor (`''` → `null`, dinero, paginación, `sanitizeSearch`) |
| `lib/auth/roles.ts` | `roleAtLeast()`; jerarquía `admin ≥ manager ≥ cashier` |
| `lib/api/client.ts` | `apiGet/apiList/apiPost/apiPatch/apiDelete` y `ApiError`; 401 fuera de `auth/*` redirige a `/login` |
| `lib/money.ts` | `formatMoney()` con `Intl.NumberFormat` |

## Contrato

Éxito: `{ "data": … }`. Listas: `{ "data": [...], "page", "pageSize", "total" }` (`?page&pageSize&q`; `pageSize` ≤ 100, por defecto 25).
`204` sin cuerpo. Todas las respuestas llevan `Cache-Control: no-store`.

Error: `{ "error": { "code", "message", "details"? } }`.

| Estado | `code` | Cuándo |
|---|---|---|
| 400 | `bad_request` | JSON mal formado; valor con formato inválido para Postgres (`22P02`) |
| 401 | `unauthorized` | Sin sesión, sesión inválida, perfil ausente/inválido o usuario inactivo |
| 403 | `forbidden` | Rol insuficiente; RLS (`42501`); petición de escritura de otro origen |
| 404 | `not_found` | Recurso inexistente (`PGRST116`) |
| 409 | `conflict` | `UNIQUE` (`23505`) o clave foránea (`23503`) |
| 422 | `validation_failed` | Falla zod; `details` = `[{ path, message }]` |
| 422 | `unprocessable` | `CHECK`/`NOT NULL` (`23514`, `23502`) o `RAISE EXCEPTION` de un RPC (`P0001`, p. ej. `insufficient stock for product …`) |
| 500 | `internal_error` | Cualquier otra cosa; el detalle solo va al log del servidor |

**Los mensajes crudos de Postgres nunca llegan al cliente**, con una excepción deliberada: `P0001`, porque esos mensajes los escribimos
nosotros en las RPC para el usuario.

## Cómo se usa `route()`

```ts
// app/api/v1/products/route.ts  (ejemplo del patrón; el recurso aún no existe)
export const POST = route({
    role: 'manager',
    body: productCreateSchema,
    handler: async ({ supabase, body }) => created(await createProduct(supabase, body))
})
```

`role` es el rol **mínimo**. Los tipos de `body`, `query` y `params` se infieren de los esquemas.

## Trampas de seguridad que esta capa ya cubre (y las que no)

| Tema | Tratamiento |
|---|---|
| CSRF con sesión por cookie | `route()` rechaza escrituras cuyo `Origin` no coincide con el `Host` servido (`x-forwarded-host` detrás de proxy). Sin `Origin` (clientes no navegador) se permite: no llevan cookies ambientales |
| Asignación masiva | Los esquemas solo listan columnas escribibles; zod descarta el resto (`role`, `total`, `loyalty_points`, `id`…) |
| `''` hacia columnas opcionales/`UNIQUE` | Normalizado a `null` en los esquemas (regla dura 5) |
| Dinero | Se redondea a 2 decimales y se rechaza precisión real (`1.005`); tasa de impuesto como fracción `0–1` |
| Inyección en filtros PostgREST | `sanitizeSearch()` elimina `, ( ) " \ % * _` antes de armar `.or()`/`ilike` |
| **`UPDATE`/`DELETE` bloqueado por RLS** | **No devuelve error, afecta 0 filas.** Los servicios deben comprobar el número de filas y responder `404`. *(Pendiente en los servicios.)* |
| `PATCH` con zod `.default()` | Evitado a propósito: `.partial()` con defaults reinicia campos. Los defaults los pone la BD |

## Pendiente (depende de los Pasos 3–4)

1. `types/database.ts` (`bun run db:types`) y `AppSupabaseClient = SupabaseClient<Database>` en `lib/server/supabase.ts`.
2. `lib/server/services/*` y los Route Handlers de la tabla de endpoints del plan.
3. `lib/api/<recurso>.ts` por recurso y refactor de las páginas (que hoy siguen llamando a Supabase; por eso el lint falla).
4. Retirar `connect-src` de Supabase de la CSP (`next.config.ts`) y borrar `lib/supabase/client.ts`.
