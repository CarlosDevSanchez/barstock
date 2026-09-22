# Hallazgos medios y bajos (M1–M18)

> Base: commit `54962b9` · Las filas de la tabla de abajo son el **hallazgo original** (evidencia y recomendación, en pasado). El estado actual está en esta primera tabla.
> Esfuerzo: S = pequeño (< 1 día), M = medio (1–3 días), L = grande (> 3 días).

## Estado tras la etapa 1

**Verificado** = hay pruebas automáticas que lo demuestran; **Corregido** = hecho y comprobado a mano, sin prueba automática; **Parcial** = lo esencial hecho, con lo pendiente indicado. Nada de esto se ha aplicado aún a la base real.

| ID | Estado | Qué se hizo / qué falta |
|---|---|---|
| M1 | **Verificado** | Índice único parcial `inventory(product_id) WHERE variant_id IS NULL` (`rls.test.ts`) |
| M2 | **Verificado** | `CHECK`, `NOT NULL` en FKs de pertenencia, índices (`orders(status, created_at)`, FKs) — [índices](../../02-base-de-datos/05-indices-y-constraints.md) |
| M3 | **Verificado** | `ORD-YYMMDD-NNNNNN` con `order_number_seq`, generado en `create_sale` (`sales.test.ts`) |
| M4 | Corregido | Migraciones versionadas, `profiles.id ON DELETE CASCADE`, borrado lógico de productos. Falta aplicarlas a la BD real ([guía](../../05-guias/verificar-checkout.md)) |
| M5 | **Verificado** | Paginación y búsqueda en servidor con `sanitizeSearch` (`catalog.test.ts`). Los servicios aún usan `select('*')` en varias tablas |
| M6 | **Verificado** | Agregación en SQL: stock bajo exacto por fila, sin reembolsos, zona horaria de Ajustes (`admin.test.ts`, `rpc.test.ts`); "Loyalty Points" se deriva por trigger |
| M7 | Parcial | Capa de datos y de servicios hechas; el layout es Server Component, pero **las páginas siguen siendo Client Components** (interactivas) y la navegación sigue duplicada entre escritorio y móvil |
| M8 | **Verificado** | Carrito inmutable, solo ids y cantidades, cantidad 0 elimina la línea, se vacía en el logout (`cart.test.ts`) |
| M9 | Parcial | Hechos: CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy`, HSTS, `Permissions-Policy`, contraseña mínima 10, cookies `HttpOnly`, errores sin mensajes crudos. **Falta:** rate limiting propio (solo el de Supabase Auth) y una CSP sin `'unsafe-inline'` (exigiría nonces y render dinámico) |
| M10 | **Verificado** | Cero `any` (lint `--max-warnings 0`), `unknown` en `catch`, `ConfirmDialog` en vez de `confirm()`, `{ error }` siempre comprobado (`assertNoError`) |
| M11 | Parcial | Lint en 0. Se eliminó el código muerto salvo `components/ui/tabs.tsx` y los 5 SVG de `public/` |
| M12 | Corregido | `README.md` reescrito y `docs/` como fuente de verdad |
| M13 | Parcial | Hechos: 264 pruebas (107 unitarias, 21 de componentes, 123 de integración, 13 e2e) (unitarias, componentes, integración, e2e), CI y Dependabot. **Falta:** monitoreo de errores (Sentry), logging estructurado y alertas |
| M14 | **Verificado** | `''` → `null` en los esquemas (`resources.test.ts`, `catalog.test.ts`) |
| M15 | Parcial | `aria-label` en botones de icono, etiquetas asociadas por `FormControl`. **Falta** una auditoría con axe/Lighthouse |
| M16 | Parcial | Las funciones nuevas fijan `search_path = ''`; `handle_new_user` se reescribió así. **Sigue** usando `uuid_generate_v4()` |
| M17 | **Verificado** | `settings.timezone` + agregación SQL con zona (`rpc.test.ts`) |
| M18 | Parcial | El POS ya no imprime; el select de cliente tiene "Walk-in Customer"; se quitó el ítem "Profile" sin acción. **Falta** plantilla de recibo (`receipt_template` se guarda pero no se imprime) y resaltar rutas hijas en la navegación |

## Hallazgos originales

| ID | Sev. | Área | Hallazgo | Evidencia | Recomendación | Esf. |
|---|---|---|---|---|---|---|
| **M1** | Media | BD | `UNIQUE(product_id, variant_id)` no impide duplicados con `variant_id` NULL; crear filas duplicadas de inventario para un mismo producto es posible | `schema.sql:84` | Índice único parcial `(product_id) WHERE variant_id IS NULL`, o `UNIQUE NULLS NOT DISTINCT` (PG ≥ 15) | S |
| **M2** | Media | BD | Sin `CHECK` (cantidades, precios, importes) y FKs de pertenencia nullable; faltan índices en FKs y en `orders(status, created_at)` | [índices y constraints](../../02-base-de-datos/05-indices-y-constraints.md) | Añadirlos vía migración | S |
| **M3** | Media | Lógica | `order_number = ORD-${Date.now()}` puede colisionar entre cajas (`UNIQUE`) y no es legible/secuencial | `pos/page.tsx:90` | Secuencia Postgres con prefijo/fecha, generada en la RPC | S |
| **M4** | Media | BD | Sin migraciones versionadas; `schema.sql` + `fix_rls_policies.sql` ad hoc; sin soft delete; `profiles.id` sin `ON DELETE CASCADE`; borrado de producto arrasa inventario y bitácora | [seed y migraciones](../../02-base-de-datos/06-seed-y-migraciones.md) | Supabase CLI + `supabase/migrations/`; `is_active`/`deleted_at`; revisar cascadas | M |
| **M5** | Media | Performance | Ninguna lista está paginada; 12 `select('*')` y 4 usos de `limit/range`; búsqueda en memoria tras descargar la tabla | [capa de datos](../../01-arquitectura/05-capa-de-datos.md) | Paginación por rango, columnas explícitas, búsqueda en servidor (`ilike`/`pg_trgm`) | M |
| **M6** | Media | Lógica/Reportes | Dashboard: KPI "Low Stock" topado en 5 (`limit(5)`), umbral fijo 10, 7 consultas secuenciales, "hoy" en UTC. Top productos con `limit(100/1000)` sin orden e incluyendo ventas reembolsadas. Reportes: "Active Customers" = `topCustomers.length`; columna "Loyalty Points" muestra `floor(total_spent)` | [dashboard](../../03-modulos/dashboard.md), [reportes](../../03-modulos/reportes.md) | Vistas/RPC agregadas, zona horaria del negocio, excluir no completadas | M |
| **M7** | Media | Arquitectura | 100 % cliente: 15 páginas + layout `use client`; sin capa de datos; UI, datos y reglas mezclados en páginas de 120–420 líneas; nav y menú duplicados (`layout.tsx:86-213`) | [estructura](../../01-arquitectura/02-estructura-de-carpetas.md) | `lib/data/*`, Server Components para lecturas, extraer `SidebarNav`/`UserMenu` | L |
| **M8** | Media | Estado | Carrito: mutación de objeto en `addItem` (`cart.ts:40`), persiste el `Product` completo (precio obsoleto), cantidad 0 permitida, no se limpia en logout | [estado cliente](../../01-arquitectura/04-estado-cliente.md) | Inmutabilidad; persistir solo ids/cantidades; `clearCart()` en logout | S |
| **M9** | Media | Seguridad | Sin headers de seguridad (`next.config.ts` vacío); contraseña mínima 6; sin rate limiting propio (depende de Supabase); mensajes de error crudos al usuario | `next.config.ts`, `register/page.tsx:32` | `headers()` con CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS; política de contraseña y CAPTCHA en Supabase | S |
| **M10** | Baja | Errores | 13 `catch (error: any)`, 24 `no-explicit-any` en total; `confirm()` nativo; errores de `select` ignorados; `try/catch` inútil (supabase-js no lanza) | `grep 'catch (error: any)'`, [lint](../lint-y-tipos.md) | `unknown` + helper `getErrorMessage`; `AlertDialog`; revisar `{ error }` siempre | S |
| **M11** | Baja | Calidad | ESLint: 32 errores y 10 warnings; código muerto (`lib/constants.ts`, `stores/settings.ts`, `ui/form.tsx`, `ui/tabs.tsx`, SVG del scaffold) | [lint](../lint-y-tipos.md), [estructura](../../01-arquitectura/02-estructura-de-carpetas.md) | `eslint --fix`, tipar embeds, borrar o usar lo muerto | S |
| **M12** | Baja | Docs | README inexacto (Next 14, middleware, RBAC, variantes, PO…), setup con ruta de Windows y `.env.local.example` inexistente; sin CONTRIBUTING/ADR/runbooks | [readme-vs-realidad](../readme-vs-realidad.md) | Reescribir README; usar esta carpeta `docs/` como fuente | S |
| **M13** | Media | Testing/DevOps | Cero tests; sin CI; sin monitoreo (Sentry/APM); sin logging estructurado; sin Dependabot | [tooling](../../01-arquitectura/07-configuracion-y-tooling.md) | Vitest para lógica y esquemas; Playwright para el flujo de venta; GitHub Actions; Sentry | L |
| **M14** | Media | Formularios | Cadenas vacías enviadas a columnas `UNIQUE`/`uuid`: `barcode: ''` y `category_id: ''` (productos), `email: ''` (clientes) **[Inferido]** | `products/page.tsx:23-33,57-62`, `customers/page.tsx:22-27,44` | Normalizar `''` → `null` (zod `.transform`); validar antes de enviar | S |
| **M15** | Baja | Accesibilidad | 0 `aria-label`; botones de icono sin nombre; solo 18 de 36 `Label` con `htmlFor` | [UI](../../01-arquitectura/06-ui-y-diseno.md) | `aria-label`, `htmlFor`/`id`, revisión axe/Lighthouse | S |
| **M16** | Baja | BD | Funciones sin `SET search_path` (`handle_new_user` es `SECURITY DEFINER`); `uuid_generate_v4()` en lugar de `gen_random_uuid()` nativo | `schema.sql:340-387` | `SET search_path = ''` y calificar nombres; migrar a `gen_random_uuid()` | S |
| **M17** | Media | Lógica | Zona horaria: rangos "por día" en UTC en dashboard; local en reportes; sin ajuste de zona del negocio | `dashboard/page.tsx:30,71-77` vs `reports/page.tsx:44-51` | Guardar zona en `settings` y agregar en SQL (`date_trunc … at time zone`) | S |
| **M18** | Baja | UX | `window.print()` tras `clearCart()` imprime la pantalla, no un recibo; sin plantilla (`receipt_template` del seed sin uso); Select de cliente sin opción "sin cliente"; ítem "Profile" sin acción; nav activo por igualdad exacta | `pos/page.tsx:168-175`, `layout.tsx:93,129-132` | Página `/orders/[id]/receipt` imprimible con datos de tienda; opción "Walk-in"; usar `startsWith` para el activo | S |

## Priorización sugerida

- **Con C2/C1 (mismo sprint):** M1, M2, M3, M14 (todos tocan las mismas tablas/formularios).
- **Siguiente:** M9, M13, M8, M5, M6/M17.
- **Cuando haya capacidad:** M7, M4, M10, M11, M12, M15, M16, M18.
