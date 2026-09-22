# Convenciones de código

> Actualizado tras la etapa 1. Parte descriptiva (lo que el código hace hoy) y parte normativa (reglas para código **nuevo**). Lo que se puede automatizar, lo impone una herramienta:
> Prettier (`.prettierrc.json`), ESLint (`eslint.config.mjs`, `--max-warnings 0`) y `tsc --noEmit` (`strict` + `noUncheckedIndexedAccess`) corren en el CI.

## Estilo (lo impone Prettier)

4 espacios, **sin punto y coma**, comillas simples, sin comas finales, paréntesis en flechas solo si hacen falta, ancho 120; JSON a 2 espacios. `bun run format` formatea.
`components/ui/*` y `lib/utils.ts` (shadcn) se excluyen para conservar su estilo upstream y **no se reformatean**; tampoco código ajeno al cambio (regla dura 13). `"use client"` va en la primera línea.
Alias `@/…` para todo.

## Nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Rutas | `page.tsx`, `route.ts`, `layout.tsx` en carpetas kebab-case | `forgot-password/page.tsx` |
| Página | `PascalCase` + `Page` | `ProductsPage`, `OrderDetailPage` |
| Diálogo/formulario de una página | `XxxDialog` en el mismo archivo | `ProductDialog`, `RefundDialog` |
| Handlers | `handleX` / `onSubmit` de `form.handleSubmit` | `handleCheckout` |
| Estado de un diálogo | `editing` (`undefined` cerrado · `null` crear · objeto editar), `toDelete` | |
| Lectura de datos | `useApiQuery(fetcher, key)` → `products`, `orders`… | |
| Módulos de API del navegador | `xxxApi` en `lib/api/xxx.ts` | `productsApi.list` |
| Servicios | funciones `listX`, `getX`, `createX`, `updateX`, `deleteX` que reciben el cliente | `updateProduct(supabase, id, patch)` |
| Esquemas zod | `xxxCreateSchema`, `xxxUpdateSchema` (parcial), `xxxQuerySchema` | `productCreateSchema` |
| Tipos de entrada | `z.output<…>` exportados como `XxxCreate` | `ProductCreate` |
| Store | `useXStore` en `stores/x.ts` | `useCartStore` |
| Tablas/columnas | `snake_case` | `selling_price` |
| Pruebas | `x.test.ts(x)` junto al código; `test/integration/`; `e2e/*.e2e.ts` | |

## Reglas para código nuevo

### Datos y seguridad
1. **Nunca** confiar en importes, precios, impuestos, totales ni permisos calculados en el cliente para escribir. Las escrituras multi-tabla van por **RPC transaccional** ([API](../01-arquitectura/08-api.md), [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md)).
2. Toda tabla nueva: `ENABLE ROW LEVEL SECURITY` y políticas **por rol** desde la primera migración; `REVOKE` a `anon`; nada de `USING (true)` ni `auth.role() = 'authenticated'` como única condición. Añadir su prueba en `rls.test.ts`.
3. **Todo endpoint** usa `route({ role, body, query, params, handler })` (o `publicRoute`); el rol es el **mínimo** necesario. La UI oculta lo que el rol no puede hacer, pero **la barrera real es la API + RLS**.
4. Toda entrada pasa por un esquema **zod** de `lib/validation/` y la BD la refuerza con `CHECK`/`NOT NULL`/enum. Los esquemas listan **solo columnas escribibles** (zod descarta el resto), convierten `''` → `null` y **no usan `.default()`** (rompe `PATCH`; los defaults los pone la BD).
5. `<input type="number">` entrega un **string**: usar `money`, `positiveInt`, `taxRatePercent` o `toNumber` (nunca interpretan `''` como 0), con mensajes legibles (`numberField()`).
6. Los servicios **comprueban siempre `{ error }`** (`assertNoError`) y tratan "0 filas" como 404 (RLS no lanza error al bloquear un `UPDATE`/`DELETE`).
7. Filtrar `NULL` con `.is('col', null)`, **nunca** `.eq('col', null)`. No concatenar strings en un `select` de supabase-js (degrada el tipo a `string`).
8. **Nunca** `service_role` fuera de `lib/server/supabase-admin.ts` ni en variables `NEXT_PUBLIC_*`. Los mensajes crudos de Postgres no llegan al cliente.
9. Dinero: `NUMERIC` en BD; en cliente, aritmética en centavos (`lib/cart-preview.ts`) y formato con `useMoney()`; nada de `toFixed` para calcular ni `$` fijo.
10. Sin `any`: `unknown` en `catch`; tipos generados de la BD (`bun run db:types` tras cada migración).
11. Los enums de la BD y los del código deben coincidir (hay pruebas que lo comprueban).

### Estructura
12. `app/(auth)`, `app/(dashboard)` y `components/` **no** importan `@supabase/*`, `@/lib/supabase` ni `@/lib/server` (lint). Solo `lib/api/*`. Única excepción: `app/(dashboard)/layout.tsx` (Server Component).
13. Un servicio por recurso en `lib/server/services/`; el Route Handler es fino. Lo compartido entre cliente y servidor va en `lib/validation/`.
14. Lecturas con `useApiQuery` (la `key` incluye **todas** las entradas de la petición). No copiar datos del servidor a un store; no persistir en el navegador nada que el servidor deba decidir; vaciar en el logout lo ligado a la sesión.
15. Los formularios usan `react-hook-form` + `zodResolver` con el **mismo esquema** del servidor y los campos de `components/form-fields.tsx`. Un formulario de autenticación usa `method="post"` y espera a `useHydrated()`.

### UI
16. Reutilizar `components/ui/*` y los compartidos (`ConfirmDialog`, `Pagination`, `QueryError`, `PageSpinner`). Acciones destructivas con `ConfirmDialog`, nunca `window.confirm()`.
17. Botones de solo icono con `aria-label`. Listas con paginación y búsqueda **en servidor**.
18. La interfaz está en **inglés** (D12 pendiente).

### Calidad
19. `bun run format:check`, `lint`, `typecheck`, `test` y `build` pasan (`bun run check`); el CI lo exige.
20. **Toda lógica de negocio nueva lleva pruebas** ([testing](testing.md)); si toca stock o dinero, también de concurrencia, verificada **rompiendo la protección a propósito**.
21. Toda migración se prueba (`bun run db:reset` y las pruebas) y se aplica primero a staging. Cambios de esquema, RLS o flujos actualizan `docs/` en el mismo cambio.
22. Comentarios: explicar el **porqué** no evidente (una trampa, una decisión), no repetir el código. Comentarios y código en inglés.

## Git
- Commits en inglés, estilo Conventional Commits (`feat(api): …`, `fix(pos): …`, `test: …`, `docs: …`, `chore: …`), cuerpo con el porqué. Ramas `feat/…`, `fix/…`, `chore/…`.
- **No se hace commit ni push sin que se pida.** Los commits creados con Claude Code terminan con la línea `Co-Authored-By` que indique la herramienta.
- Antes de un PR: [lista de comprobación](comandos.md#lista-de-comprobación-antes-de-un-pr). No subir `.env*` (salvo `.env.example`), claves ni volcados de datos.

## Idioma
- Interfaz de usuario: **inglés** (decisión D12 pendiente). Código, commits y nombres: inglés. Documentación interna (`docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md`): **español**.
