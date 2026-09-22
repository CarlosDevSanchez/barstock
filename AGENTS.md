# AGENTS.md — barstock (POS + Inventario)

Guía para cualquier agente de IA o persona que trabaje en este repositorio. Es un **resumen operativo**; la documentación completa
está en [`docs/`](docs/README.md) (un archivo por tema). Estado: tras la **etapa 1** (rama `feat/etapa-1-base`), revisión 2026-09-21.

## 1. Qué es y en qué estado está

Aplicación de **punto de venta e inventario** para un solo negocio: catálogo, caja, órdenes y reembolsos, clientes, proveedores, stock, reportes, ajustes y usuarios con roles.
Next.js (App Router) + Supabase (Postgres, Auth, PostgREST).

> ✅ **La etapa 1 corrigió los hallazgos críticos** ([`docs/04-auditoria/README.md`](docs/04-auditoria/README.md)): RLS por rol, cobro y reembolso transaccionales, sesión en cookies, validación,
> Next 16.3.5, 264 pruebas y CI. Todo verificado **contra una base local**.
>
> ⚠️ **Aún NO apta para dinero real:** las migraciones **no se han aplicado a la base real**, el CI no se ha ejecutado todavía en GitHub, y las reglas fiscales y de negocio (D3, D6, D7, D9)
> son **supuestos sin validar** con el negocio. Pasos pendientes: [plan de remediación](docs/06-roadmap/plan-de-remediacion.md#estado-tras-la-etapa-1).
> No asumas que algo "funciona" porque un commit o un documento lo diga: comprueba con las pruebas (`bun run test`).

## 2. Stack

| | |
|---|---|
| Runtime / paquetes | Bun 1.4.1 (Node ≥ 20.9); versiones **exactas** en `package.json`; sin scripts de instalación |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5 (`strict`, `noUncheckedIndexedAccess`) |
| Backend | Supabase (Postgres 17, Auth, PostgREST) vía `@supabase/supabase-js` + `@supabase/ssr`. API propia: Route Handlers en `app/api/v1`, `proxy.ts` |
| Validación / formularios | zod 4 (esquemas compartidos cliente/servidor), react-hook-form |
| UI | Tailwind CSS 4, shadcn/ui (`new-york`) sobre Radix, lucide-react, Sonner, next-themes, Recharts, **next-intl** (ES/EN) |
| Estado de cliente | Zustand **solo para el carrito** (ids y cantidades); contexto de sesión; `useApiQuery` |
| Pruebas / CI | `bun test`, happy-dom + Testing Library, Playwright; GitHub Actions + Dependabot |

## 3. Comandos

```bash
bun install --frozen-lockfile           # instalar (respeta bun.lock; NO `bun install` a secas en CI)
bun run dev                             # http://localhost:3000
bun run typecheck                       # tsc --noEmit (hoy limpio)
bun run lint                            # limpio (0 errores, 0 warnings)
bun run format:check                    # Prettier
bun audit --audit-level=high            # limpio; el CI (.github/workflows/ci.yml) ejecuta todo esto en cada PR
bun run build                           # requiere las 4 variables de .env.example; si falta alguna, el error la nombra
bun run db:start                        # Supabase local (Docker): migraciones + seed; luego `bun run db:types`
bun run test                            # unit + components + integración (necesita db:start); `test:e2e` para Playwright
bun run test:coverage                   # ≥ 80 % en lib/server y lib/validation
bun run local:up                        # TODO en Docker: Supabase + usuarios de prueba (admin|manager|cashier@barstock.local) + app en :3000; local:down / local:reset
```

Trampas: `npx tsc` sin instalar descarga un paquete falso; **todas** las dependencias están a versión exacta (actualizar con `bun add next@x`);
Bun no ejecuta scripts `postinstall` (`trustedDependencies` vacío);
en zsh, entrecomillar los globs. Más en [`docs/05-guias/comandos.md`](docs/05-guias/comandos.md). Puesta en marcha en
[`setup-local.md`](docs/05-guias/setup-local.md); variables en [`variables-de-entorno.md`](docs/05-guias/variables-de-entorno.md).

## 4. Arquitectura en 60 segundos

- **El navegador solo habla con `/api/v1`** (Route Handlers + `lib/server/services`); las páginas son Client Components que usan `lib/api/*` y
  `useApiQuery`, y el layout del dashboard es un Server Component. Detalle: [`docs/01-arquitectura/08-api.md`](docs/01-arquitectura/08-api.md).
  El lint prohíbe importar `@supabase/*` y `lib/server` desde `app/` y `components/`.
  **Excepción:** las imágenes de producto y el logo se descargan directamente de Cloudflare R2 con URL firmadas (bucket privado) que emite el servidor; subirlas y borrarlas sí pasa por `/api/v1`.
- **Base de datos: RLS por rol** (`admin ≥ manager ≥ cashier`), usuario inactivo sin acceso, alta solo por invitación,
  ventas/reembolsos/stock **solo vía RPC transaccionales** (`create_sale`, `refund_order`, `adjust_inventory`)
  ([`docs/02-base-de-datos/`](docs/02-base-de-datos/03-rls-y-politicas.md)).
- **La lógica que toca dinero o stock está en la BD**; el cliente solo muestra una **vista previa** del carrito ([`pos-checkout`](docs/03-modulos/pos-checkout.md)).
- **Sesión en cookies `HttpOnly`** (`@supabase/ssr`); `proxy.ts` refresca la sesión y guarda rutas y roles; `route()` comprueba el rol y el origen en cada endpoint.
  **Dos capas independientes**: el rol en la API y RLS en la BD.

## 5. Mapa del repositorio

```
app/(auth)/            login, forgot-password, reset-password
app/(dashboard)/       layout (Server Component) y 13 páginas: dashboard, pos, products, categories, inventory,
                       orders(+[id]), customers(+[id]), suppliers, reports, settings, users
app/api/v1/            25 Route Handlers (route()/publicRoute()) · app/auth/confirm: canjea el enlace del correo
components/  hooks/    UI compartida (AppShell, ConfirmDialog, form-fields…) y hooks · components/ui = shadcn
lib/server/            SOLO servidor: http (route), auth, errores, clientes Supabase, services/<recurso>
lib/validation/        esquemas zod compartidos · lib/api/ cliente fetch del navegador · lib/env/ validación del entorno
lib/auth/ money.ts dates.ts cart-preview.ts
proxy.ts               sesión + guarda de rutas y de roles
stores/cart.ts         único store
types/                 database.ts (GENERADO: bun run db:types) · index.ts (derivado)
supabase/              config.toml, migrations/, templates/ (correos), seed.sql, legacy/ (SQL histórico, NO ejecutar)
test/  e2e/  scripts/  pruebas (unitarias junto al código) · Playwright (*.e2e.ts) · umbral de cobertura
.github/               ci.yml y dependabot.yml
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
7. Valida toda entrada con **zod** (`lib/validation`, el mismo esquema en cliente y servidor) y refuerza con `CHECK`/`NOT NULL`/enum en la BD.
8. No introduzcas `any`: `unknown` en `catch` y tipos de Supabase para los *embeds*.
9. Dinero: `NUMERIC` en BD; en cliente no acumules floats para escribir (usa centavos) y formatea con `useMoney()`.
10. Todo endpoint usa `route()`/`publicRoute()`; la UI oculta lo que el rol no puede hacer, pero **la barrera real es la API + RLS**. Las escrituras que RLS bloquea afectan **0 filas sin error**: los servicios lo tratan como 404.

**Proceso**
11. **No ejecutes SQL destructivo ni de escritura contra el proyecto Supabase real** (ni `DELETE`/`UPDATE` masivos). Las consultas de
    [`verificar-checkout.md`](docs/05-guias/verificar-checkout.md) son solo lectura. Las pruebas de integración/e2e solo contra Supabase **local**.
12. No subas `.env*`, claves ni volcados de datos. No commitees sin que se te pida.
13. Cambios de esquema/RLS: migración versionada (`supabase/migrations/`; **no editar una ya aplicada fuera de local**) + `bun run db:types` + prueba (RLS/RPC) + staging + actualizar `docs/`.
14. No reformatees archivos ajenos al cambio (`components/ui` y `lib/utils.ts` son de shadcn y Prettier los ignora; ver [convenciones](docs/05-guias/convenciones-de-codigo.md)).

## 7. Estilo (resumen)

**Lo impone Prettier** (`bun run format`): 4 espacios, sin punto y coma, comillas simples; `"use client"` en la primera línea, alias `@/…`. Lo impone ESLint (`--max-warnings 0`): sin `any`, sin promesas sin esperar, y la UI no importa Supabase ni `lib/server`.
Nombres: `XxxPage`, `XxxDialog`, `xxxApi`, servicios `listX/getX/createX`, esquemas `xxxCreateSchema`, `useXStore`, columnas `snake_case`. Acciones destructivas con `ConfirmDialog` (no `confirm()`); botones de icono con `aria-label`.
La UI es **bilingüe (ES por defecto + EN)** vía `next-intl` y `profiles.locale`; el código, los commits y los comentarios en inglés; la documentación en **español**. Moneda por defecto **COP** (decimales según la moneda: `currencyDecimals` / `money_scale`).
Reglas completas: [`docs/05-guias/convenciones-de-codigo.md`](docs/05-guias/convenciones-de-codigo.md).

## 8. Trampas conocidas (no asumas que esto funciona)

| Área | Realidad | Documento |
|---|---|---|
| Roles | Restringen en la BD (RLS), en cada endpoint (`route()`), en `proxy.ts` y en la navegación. No hay `/register`: el alta es por invitación | [RLS](docs/02-base-de-datos/03-rls-y-politicas.md) |
| `profiles.role` | Corregido: solo un admin lo cambia (trigger). **Ojo:** un `UPDATE`/`DELETE` que RLS no permite afecta **0 filas sin error** | [RLS](docs/02-base-de-datos/03-rls-y-politicas.md) |
| Stock al vender | Corregido: el POS llama a `POST /sales` (RPC `create_sale`) y el stock baja atómicamente | [C2](docs/04-auditoria/hallazgos/C2-checkout-no-atomico.md) |
| Crear producto | La BD crea su fila de `inventory` (trigger, cantidad 0); el stock se ajusta desde `/inventory` (gerente+) con motivo | [productos](docs/03-modulos/productos.md), [inventario](docs/03-modulos/inventario.md) |
| Formularios | Corregido en los esquemas zod (`''` → `null`). Los `<input type="number">` entregan **strings**: usar `toNumber`/`money` de `lib/validation/common` | [M14](docs/04-auditoria/hallazgos/medios-y-bajos.md) |
| Impuestos | **Por producto** (`tax_rate` = fracción `NUMERIC(6,4)`), redondeo por línea, descuento global **después** del impuesto. Es el supuesto D3, **sin validar** con contabilidad. `settings.tax_rate` solo es la tasa por defecto de un producto nuevo | [H3](docs/04-auditoria/hallazgos/H3-impuestos-y-dinero.md) |
| Ajustes (`/settings`) | Persisten en la tabla `settings` (solo admin escribe) y los lee el layout | [ajustes](docs/03-modulos/ajustes.md) |
| Recuperar contraseña | Funciona: `/forgot-password` → correo → `/auth/confirm` → `/reset-password` | [H4](docs/04-auditoria/hallazgos/H4-flujos-incompletos.md) |
| Dashboard/Reportes | Corregido: agregan en SQL, sin reembolsos, umbral por fila y zona horaria de `settings`. "Loyalty Points" = `floor(total_spent)` derivado (D7, sin validar) | [dashboard](docs/03-modulos/dashboard.md), [reportes](docs/03-modulos/reportes.md) |
| Órdenes de compra, gastos, variantes | Solo esquema: sin API, UI ni reposición de stock al recibir | [proveedores](docs/03-modulos/proveedores-y-compras.md) |
| Carrito | Persiste solo ids y cantidades y se vacía en el logout; el total mostrado es una vista previa. La burbuja del carrito está **siempre visible** (con «0» si está vacío) | [estado cliente](docs/01-arquitectura/04-estado-cliente.md) |
| Cuentas abiertas (`tabs`) | El stock baja **al añadir** el producto a la cuenta, no al cerrarla; quitar un ítem (gerente+) o anular la repone. Anular solo funciona **sin pagos** | [cuentas-abiertas](docs/03-modulos/cuentas-abiertas.md) |
| `next build` / `next dev` | Fallan si falta alguna de las 4 variables (el error nombra cuál). `next dev` no debe escribir en `AGENTS.md` (`agentRules: false`) | [H5](docs/04-auditoria/hallazgos/H5-build-sin-env.md) |
| Impresión | `window.print()` en el detalle de orden imprime un ticket térmico de 80 mm **no fiscal** (D21: sin CUFE/QR/DIAN) | [UI](docs/01-arquitectura/06-ui-y-diseno.md), [órdenes](docs/03-modulos/ordenes-y-reembolsos.md) |
| Imágenes R2 | URL firmadas de 12 h (hora de firma redondeada a la hora para que el navegador las cachee). La CSP (`img-src`) permite `https://*.r2.cloudflarestorage.com` **fijo**: `next.config.ts` se evalúa en el *build* y la imagen Docker se construye sin `R2_*`; derivar el origen de `R2_ACCOUNT_ID` hacía que el navegador bloqueara las imágenes en silencio. Sin las 4 variables, los endpoints de imagen responden 503 | [API](docs/01-arquitectura/08-api.md), [productos](docs/03-modulos/productos.md) |
| Cookies de sesión | `@supabase/ssr` las crea `httpOnly: false`; `lib/auth/cookie-options.ts` las fuerza a `HttpOnly` (y `Secure` cuando `APP_URL` es https). Mantenerlo | [autenticación](docs/01-arquitectura/03-autenticacion-y-sesion.md) |
| Formularios de auth | Enviados antes de hidratar hacen un `GET` nativo y **ponen la contraseña en la URL**: `method="post"` + botón deshabilitado hasta `useHydrated()` | [autenticación](docs/01-arquitectura/03-autenticacion-y-sesion.md) |
| Alta de usuarios | Solo por invitación. Un perfil nace **activo únicamente si el servidor le asignó rol** (`app_metadata`); `user_metadata` no se usa. Un usuario desactivado no puede entrar aunque su sesión siga válida | [usuarios](docs/03-modulos/usuarios.md) |
| `mock.module` (Bun) | Es **global al proceso** y se filtra entre archivos de test: por eso unitarias, componentes (un proceso por archivo) e integración corren separadas | [testing](docs/05-guias/testing.md) |
| Tests de integración | Escriben datos: **solo contra Supabase local** (se niegan a ejecutarse contra otro host). `bun run db:reset` limpia | [testing](docs/05-guias/testing.md) |
| supabase-js y `select` | El tipo del resultado se infiere del **literal** del `select`; concatenar strings lo degrada a `string` | [capa de datos](docs/01-arquitectura/05-capa-de-datos.md) |

## 9. Antes de tocar X, lee Y

| Si vas a… | Lee primero |
|---|---|
| Añadir o cambiar un endpoint | [08-api](docs/01-arquitectura/08-api.md) |
| Modificar el cobro, carrito o stock | [pos-checkout](docs/03-modulos/pos-checkout.md), [estado cliente](docs/01-arquitectura/04-estado-cliente.md), [C2](docs/04-auditoria/hallazgos/C2-checkout-no-atomico.md) |
| Cuentas abiertas, pagos parciales | [cuentas-abiertas](docs/03-modulos/cuentas-abiertas.md) |
| Reembolsos u órdenes | [ordenes-y-reembolsos](docs/03-modulos/ordenes-y-reembolsos.md) |
| Cambiar tablas, políticas o triggers | [`docs/02-base-de-datos/`](docs/02-base-de-datos/) completo y [diseño objetivo](docs/06-roadmap/diseno-objetivo-seguridad.md) |
| Autenticación, sesión, roles | [auth](docs/01-arquitectura/03-autenticacion-y-sesion.md), [C1](docs/04-auditoria/hallazgos/C1-rls-permisivo.md), [H1](docs/04-auditoria/hallazgos/H1-sin-proteccion-servidor.md) |
| Formularios / validación | [H2](docs/04-auditoria/hallazgos/H2-sin-validacion.md), [productos](docs/03-modulos/productos.md) |
| Impuestos, descuentos, moneda | [H3](docs/04-auditoria/hallazgos/H3-impuestos-y-dinero.md), [decisiones-pendientes](docs/06-roadmap/decisiones-pendientes.md) (D3) |
| Dashboard o reportes | [dashboard](docs/03-modulos/dashboard.md), [reportes](docs/03-modulos/reportes.md) |
| Dependencias, CI, despliegue | [dependencias](docs/04-auditoria/dependencias-npm-audit.md), [tooling](docs/01-arquitectura/07-configuracion-y-tooling.md) |
| Planificar trabajo | [plan de remediación](docs/06-roadmap/plan-de-remediacion.md) |
| Aplicar las migraciones a una base con datos | [verificar-checkout](docs/05-guias/verificar-checkout.md) (antes y después), [migraciones](docs/02-base-de-datos/06-seed-y-migraciones.md) |
| Escribir o cambiar pruebas | [testing](docs/05-guias/testing.md) |

## 10. Definición de "hecho"

- [ ] `bun run typecheck` sin errores y `bun run lint` **sin errores ni warnings**.
- [ ] `bun run format:check`, `bun run test` (con `db:start`) y `bun run build` con variables definidas; el CI lo exige.
- [ ] Sin `any` nuevos, sin `.eq(col, null)`, sin cadenas vacías hacia columnas opcionales.
- [ ] Si toca datos/dinero: la lógica está en una RPC/servidor y tiene prueba (concurrencia incluida, [testing](docs/05-guias/testing.md)); si toca esquema: migración probada en staging y prueba de RLS.
- [ ] Documentación actualizada en el mismo cambio (ver §11).
- [ ] Ningún secreto ni `.env` en el diff.

## 11. Mantener la documentación viva

1. Un tema, un archivo en `docs/`; enlazar en vez de duplicar. Toda afirmación no probada lleva `[Inferido]` o `[Por verificar]`.
2. Un cambio que altere esquema, RLS, flujo de cobro o rutas **debe** actualizar el documento correspondiente en el mismo PR.
3. Al corregir un hallazgo de auditoría: actualizar su archivo en `docs/04-auditoria/hallazgos/` y el estado en
   [`docs/04-auditoria/README.md`](docs/04-auditoria/README.md) (Abierto → En curso → Corregido → Verificado).
4. Al cerrar una decisión de producto: registrarla en [`decisiones-pendientes`](docs/06-roadmap/decisiones-pendientes.md).
5. Las referencias `archivo:línea` de `docs/04-auditoria/` apuntan al commit `54962b9` (registro histórico); en el resto de la documentación se cita el archivo, no la línea.
6. Enlaces relativos; comprobar que no quedan rotos tras mover o renombrar.

## 12. Glosario

[`docs/glosario.md`](docs/glosario.md).
