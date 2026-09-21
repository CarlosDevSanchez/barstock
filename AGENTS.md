# AGENTS.md — barstock (POS + Inventario)

Guía para cualquier agente de IA o persona que trabaje en este repositorio. Es un **resumen operativo**; la documentación completa
está en [`docs/`](docs/README.md) (un archivo por tema). Base de esta guía: commit `54962b9`, revisión 2026-09-21.

## 1. Qué es y en qué estado está

Aplicación de **punto de venta e inventario** para un solo negocio: catálogo, cobro en caja, órdenes y reembolsos, clientes,
proveedores, stock y reportes. Next.js (App Router) + Supabase (Postgres, Auth, PostgREST).

> ⚠️ **Es un prototipo funcional, NO apto para dinero real todavía.** Auditoría completa en
> [`docs/04-auditoria/README.md`](docs/04-auditoria/README.md). Dos críticos abiertos: no hay autorización efectiva (RLS permisivo)
> y el cobro no es atómico (el stock probablemente no se descuenta). C3 (`next` vulnerable) ya está actualizado a `16.3.5`. No asumas que algo
> "funciona" solo porque el README o el commit lo digan: ver [`readme-vs-realidad`](docs/04-auditoria/readme-vs-realidad.md).

## 2. Stack

| | |
|---|---|
| Framework | Next.js `16.3.5` (App Router, Turbopack), React `19.3.0`, TypeScript `^5` (`strict`) |
| Backend | Supabase vía `@supabase/supabase-js 2.116.0` (+ `@supabase/ssr`). **No hay API routes, Server Actions ni middleware** |
| UI | Tailwind CSS 4, shadcn/ui (`new-york`) sobre Radix, lucide-react, Sonner, next-themes, Recharts |
| Estado | Zustand (`stores/auth.ts`, `stores/cart.ts` persistido, `stores/settings.ts` **sin uso**) |
| Instalado **sin uso** | `zod`, `react-hook-form`, `@hookform/resolvers` |

## 3. Comandos

```bash
bun install --frozen-lockfile           # instalar (respeta bun.lock; NO `bun install` a secas en CI)
bun run dev                             # http://localhost:3000
bun run typecheck                       # tsc --noEmit (hoy limpio)
bun run lint                            # HOY FALLA: 93 errores (reglas estrictas; caen con el refactor a API)
bun run format:check                    # Prettier (el reformateo del repo va en un commit aparte)
bun audit --audit-level=high            # limpio (C3 en curso: falta CI)
bun run build                           # requiere las 4 variables de .env.example; si falta alguna, el error la nombra
```

Trampas: `npx tsc` sin instalar descarga un paquete falso; **todas** las dependencias están a versión exacta (actualizar con `bun add next@x`);
Bun no ejecuta scripts `postinstall` (`trustedDependencies` vacío);
en zsh, entrecomillar los globs. Más en [`docs/05-guias/comandos.md`](docs/05-guias/comandos.md). Puesta en marcha en
[`setup-local.md`](docs/05-guias/setup-local.md); variables en [`variables-de-entorno.md`](docs/05-guias/variables-de-entorno.md).

## 4. Arquitectura en 60 segundos

- **Todo corre en el navegador.** 15 de 16 páginas y el layout del dashboard son `"use client"`; cada página llama a `supabase` directamente.
  Sin capa de datos (`lib/data/` no existe). Detalle: [`docs/01-arquitectura/`](docs/01-arquitectura/01-vision-general.md).
- **El único control de acceso del servidor es RLS.** Hoy permite todo a cualquier usuario autenticado
  ([`docs/02-base-de-datos/03-rls-y-politicas.md`](docs/02-base-de-datos/03-rls-y-politicas.md)). Los roles (`admin/manager/cashier`) son
  **cosméticos**: `isAdmin()`, `isManager()`, `canManageProducts()` no se llaman en ningún sitio.
- **La lógica de negocio (totales, stock, reembolso) está en el cliente**, sin transacciones
  ([`docs/03-modulos/pos-checkout.md`](docs/03-modulos/pos-checkout.md)).
- **Guarda de rutas solo en cliente** (`app/(dashboard)/layout.tsx:44-67`); sesión en `localStorage`.

## 5. Mapa del repositorio

```
app/(auth)/            login, register, forgot-password (públicas)
app/(dashboard)/       layout (guarda + nav) y 12 pantallas: dashboard, pos, products, categories, inventory,
                       orders(+[id]), customers(+[id]), suppliers, reports, settings
components/ui/         shadcn (16; form.tsx y tabs.tsx sin uso) · components/theme-provider.tsx
lib/                   supabase/client.ts (singleton), utils.ts (cn), constants.ts (SIN uso)
stores/                auth.ts, cart.ts, settings.ts (SIN uso)
types/index.ts         tipos escritos a mano (no generados)
supabase/              schema.sql → fix_rls_policies.sql → seed.sql (a mano; sin migraciones)
docs/                  documentación interna (ver índice)
```

Detalle y tamaños: [`docs/01-arquitectura/02-estructura-de-carpetas.md`](docs/01-arquitectura/02-estructura-de-carpetas.md).

## 6. Reglas duras (no negociables al escribir código)

**Datos y seguridad**
1. **Nunca** confíes en precios, impuestos, descuentos, totales ni permisos calculados en el cliente para **escribir** en la BD.
   Las escrituras multi-tabla van por **RPC transaccional** (`create_sale`, `refund_order`, `adjust_inventory`; diseño en
   [`docs/06-roadmap/diseno-objetivo-seguridad.md`](docs/06-roadmap/diseno-objetivo-seguridad.md)).
2. Toda tabla nueva lleva RLS **por rol** desde el primer commit. **Prohibido** `USING (true)` o `auth.role() = 'authenticated'` como única condición.
3. **Nunca** uses la clave `service_role` en código cliente ni en variables `NEXT_PUBLIC_*`.
4. Filtra `NULL` con `.is('col', null)`. **`.eq('col', null)` NO funciona** (se serializa como `eq.null`; ver [C2](docs/04-auditoria/hallazgos/C2-checkout-no-atomico.md)).
5. Convierte `''` en `null` antes de insertar en columnas opcionales o `UNIQUE` (`barcode`, `category_id`, `email`).
6. Comprueba siempre `{ error }` de cada llamada a Supabase: no lanza excepciones, `try/catch` no basta.
7. Valida toda entrada con **zod** (ya instalado) y refuerza con `CHECK`/`NOT NULL`/enum en la BD.
8. No introduzcas `any`: `unknown` en `catch` y tipos de Supabase para los *embeds*.
9. Dinero: `NUMERIC` en BD; en cliente no acumules floats para escribir; formatea con `Intl.NumberFormat`.

**Proceso**
10. **No ejecutes SQL destructivo ni de escritura contra el proyecto Supabase real** (ni `DELETE`/`UPDATE` masivos, ni las pruebas de
    [`verificar-checkout.md`](docs/05-guias/verificar-checkout.md) en producción). Solo lectura o entornos de desarrollo/staging.
11. No subas `.env*`, claves ni volcados de datos. No commitees sin que se te pida.
12. Cambios de esquema/RLS: migración versionada (`supabase/migrations/`, cuando exista) + prueba en staging + actualizar `docs/`.
13. No reformatees archivos ajenos al cambio (el estilo no está automatizado; ver [convenciones](docs/05-guias/convenciones-de-codigo.md)).

## 7. Estilo (resumen)

En `app/` y `stores/`: **4 espacios, sin punto y coma, comillas simples**, `"use client"` en la primera línea, alias `@/…`.
Nombres: `XxxPage`, `handleX`, `fetchX`, `formData`, `searchQuery`, `useXStore`, columnas `snake_case`. UI reutiliza `components/ui/*`;
acciones destructivas con `AlertDialog` (no `confirm()`); botones de icono con `aria-label`. La UI actual está en **inglés**; la documentación en **español**.
Reglas completas: [`docs/05-guias/convenciones-de-codigo.md`](docs/05-guias/convenciones-de-codigo.md).

## 8. Trampas conocidas (no asumas que esto funciona)

| Área | Realidad | Documento |
|---|---|---|
| Roles | No restringen nada; el selector de rol del registro se ignora (todos nacen `cashier`) | [auth](docs/01-arquitectura/03-autenticacion-y-sesion.md) |
| `profiles.role` | El propio usuario puede modificarlo por API | [C1](docs/04-auditoria/hallazgos/C1-rls-permisivo.md) |
| Stock al vender | Probablemente **no se descuenta** (`.eq('variant_id', null)`); el toast dice éxito | [C2](docs/04-auditoria/hallazgos/C2-checkout-no-atomico.md) |
| Crear producto | No crea su fila de `inventory`; no hay UI para crear/ajustar stock | [productos](docs/03-modulos/productos.md), [inventario](docs/03-modulos/inventario.md) |
| Formularios | `barcode: ''`, `category_id: ''`, `email: ''` chocan con `UNIQUE`/`uuid` (segundo registro falla) | [M14](docs/04-auditoria/hallazgos/medios-y-bajos.md) |
| Impuestos | Orden usa tasa global `0.1`; líneas usan `product.tax_rate`; no coinciden. `tax_rate` es `DECIMAL(5,2)` | [H3](docs/04-auditoria/hallazgos/H3-impuestos-y-dinero.md) |
| Ajustes (`/settings`) | No persisten; `settings` (tabla) y `stores/settings.ts` no se leen | [ajustes](docs/03-modulos/ajustes.md) |
| Recuperar contraseña | `/reset-password` no existe (404) | [H4](docs/04-auditoria/hallazgos/H4-flujos-incompletos.md) |
| Dashboard/Reportes | KPI "Low Stock" topado en 5; top productos con `limit` sin orden y con ventas reembolsadas; "Loyalty Points" = `floor(total_spent)` | [dashboard](docs/03-modulos/dashboard.md), [reportes](docs/03-modulos/reportes.md) |
| Órdenes de compra, gastos, variantes | Solo esquema; sin UI | [proveedores](docs/03-modulos/proveedores-y-compras.md) |
| Carrito | Persiste el `Product` completo (precio obsoleto) y no se limpia al cerrar sesión | [estado cliente](docs/01-arquitectura/04-estado-cliente.md) |
| `next build` / `next dev` | Fallan si falta alguna de las 4 variables (el error nombra cuál) | [H5](docs/04-auditoria/hallazgos/H5-build-sin-env.md) |
| Impresión | `window.print()` tras vaciar el carrito; no hay recibo | [UI](docs/01-arquitectura/06-ui-y-diseno.md) |
| README | Inexacto en muchos puntos | [readme-vs-realidad](docs/04-auditoria/readme-vs-realidad.md) |

## 9. Antes de tocar X, lee Y

| Si vas a… | Lee primero |
|---|---|
| Modificar el cobro, carrito o stock | [pos-checkout](docs/03-modulos/pos-checkout.md), [estado cliente](docs/01-arquitectura/04-estado-cliente.md), [C2](docs/04-auditoria/hallazgos/C2-checkout-no-atomico.md) |
| Reembolsos u órdenes | [ordenes-y-reembolsos](docs/03-modulos/ordenes-y-reembolsos.md) |
| Cambiar tablas, políticas o triggers | [`docs/02-base-de-datos/`](docs/02-base-de-datos/) completo y [diseño objetivo](docs/06-roadmap/diseno-objetivo-seguridad.md) |
| Autenticación, sesión, roles | [auth](docs/01-arquitectura/03-autenticacion-y-sesion.md), [C1](docs/04-auditoria/hallazgos/C1-rls-permisivo.md), [H1](docs/04-auditoria/hallazgos/H1-sin-proteccion-servidor.md) |
| Formularios / validación | [H2](docs/04-auditoria/hallazgos/H2-sin-validacion.md), [productos](docs/03-modulos/productos.md) |
| Impuestos, descuentos, moneda | [H3](docs/04-auditoria/hallazgos/H3-impuestos-y-dinero.md), [decisiones-pendientes](docs/06-roadmap/decisiones-pendientes.md) (D3) |
| Dashboard o reportes | [dashboard](docs/03-modulos/dashboard.md), [reportes](docs/03-modulos/reportes.md) |
| Dependencias, CI, despliegue | [dependencias](docs/04-auditoria/dependencias-npm-audit.md), [tooling](docs/01-arquitectura/07-configuracion-y-tooling.md) |
| Planificar trabajo | [plan de remediación](docs/06-roadmap/plan-de-remediacion.md) |
| Confirmar una hipótesis con la BD | [verificar-checkout](docs/05-guias/verificar-checkout.md) |

## 10. Definición de "hecho"

- [ ] `bun run typecheck` sin errores y `bun run lint` sin errores **nuevos** (idealmente reduciendo los 93 existentes).
- [ ] `bun run build` con variables definidas.
- [ ] Sin `any` nuevos, sin `.eq(col, null)`, sin cadenas vacías hacia columnas opcionales.
- [ ] Si toca datos/dinero: la lógica está en una RPC/servidor y tiene prueba; si toca esquema: migración probada en staging.
- [ ] Documentación actualizada en el mismo cambio (ver §11).
- [ ] Ningún secreto ni `.env` en el diff.

## 11. Mantener la documentación viva

1. Un tema, un archivo en `docs/`; enlazar en vez de duplicar. Toda afirmación no probada lleva `[Inferido]` o `[Por verificar]`.
2. Un cambio que altere esquema, RLS, flujo de cobro o rutas **debe** actualizar el documento correspondiente en el mismo PR.
3. Al corregir un hallazgo de auditoría: actualizar su archivo en `docs/04-auditoria/hallazgos/` y el estado en
   [`docs/04-auditoria/README.md`](docs/04-auditoria/README.md) (Abierto → En curso → Corregido → Verificado).
4. Al cerrar una decisión de producto: registrarla en [`decisiones-pendientes`](docs/06-roadmap/decisiones-pendientes.md).
5. Las referencias `archivo:línea` de la documentación apuntan al commit `54962b9`; si el código cambia, revisarlas.

## 12. Glosario

[`docs/glosario.md`](docs/glosario.md).
