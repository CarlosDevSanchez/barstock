# barstock — Punto de venta e inventario

Aplicación web de **punto de venta e inventario** para un solo negocio: catálogo, caja, órdenes y reembolsos, clientes, proveedores, stock, reportes, ajustes y gestión de usuarios con roles.
Next.js (App Router) + Supabase (Postgres, Auth, PostgREST) + TypeScript.

> ## Estado: apta para pruebas, **no desplegada**
> La **etapa 1** (rama `feat/etapa-1-base`) corrigió los hallazgos críticos de la [auditoría](docs/04-auditoria/README.md): autorización por rol (RLS + API), cobro y reembolso transaccionales,
> dependencias sin vulnerabilidades, validación, sesión segura, pruebas automáticas (264) y CI. Todo está verificado **contra una base local**.
>
> **Aún no se ha aplicado a la base real ni se ha ejecutado el CI en GitHub**, y hay reglas de negocio (impuestos, fidelidad, descuentos, stock) aplicadas como **supuestos sin validar** con el negocio.
> Antes de manejar dinero real: [pasos pendientes](docs/06-roadmap/plan-de-remediacion.md#estado-tras-la-etapa-1) y [supuestos por validar](docs/06-roadmap/decisiones-pendientes.md).

## Qué incluye

| Área | Funciones |
|---|---|
| **Acceso** | Login, recuperar contraseña, **alta solo por invitación** de un admin, sesión en cookies `HttpOnly`, roles `cashier` < `manager` < `admin` |
| **Caja (POS)** | Búsqueda por nombre/SKU/código, carrito, cliente opcional, descuento, efectivo/tarjeta/e-wallet. **El precio, el impuesto y el total los calcula la base de datos**; el cobro es una sola transacción |
| **Órdenes** | Historial (el cajero ve solo las suyas), detalle, **reembolso total idempotente** con motivo (repone el stock) |
| **Catálogo e inventario** | Productos y categorías; stock con **ajustes con motivo**, alertas de stock bajo por artículo, borrado lógico de productos |
| **Personas** | Clientes (fidelidad y gasto **derivados** de las ventas), proveedores, usuarios |
| **Reportes** | Dashboard y reportes por rango de fechas, agregados en SQL, en la zona horaria de la tienda |
| **Ajustes** | Nombre, moneda, zona horaria, tasa de impuesto por defecto, umbral de stock (persisten) |

No incluye todavía: órdenes de compra y gastos (solo esquema), variantes en el POS, recibo impreso, pagos mixtos ni vuelto, modo offline, multi-sucursal. Límites por módulo en [`docs/03-modulos/`](docs/03-modulos/).

## Cómo funciona (en 60 segundos)

```
navegador ─ fetch /api/v1 ─▶ proxy.ts ─▶ Route Handlers (route(): origen, rol, zod) ─▶ servicios ─▶ Supabase (JWT del usuario) ─▶ RLS + RPC
```

- El navegador **nunca** habla con Supabase ni recibe tokens; el lint prohíbe importarlo desde `app/` y `components/`.
- **Dos capas de autorización independientes**: el rol se comprueba en cada endpoint y RLS decide los datos.
- Lo que toca dinero o stock vive en la BD: RPC `create_sale`, `refund_order`, `adjust_inventory`; totales de clientes por trigger; reportes en SQL.
- Detalle: [visión general](docs/01-arquitectura/01-vision-general.md), [API](docs/01-arquitectura/08-api.md), [autenticación](docs/01-arquitectura/03-autenticacion-y-sesion.md), [RLS](docs/02-base-de-datos/03-rls-y-politicas.md).

## Puesta en marcha

### Opción rápida: todo con Docker (para verlo funcionando)

```bash
bun run local:up        # Supabase + usuarios de prueba + la app en un contenedor
```

Abre <http://localhost:3000> e inicia sesión con `admin@barstock.local`, `manager@barstock.local` o `cashier@barstock.local` (contraseña `barstock-local-2026`; **solo local**).
Trae ventas de demostración. Para parar: `bun run local:down` (o `local:reset` para borrar también los datos). Detalle en [docker-local](docs/05-guias/docker-local.md).

### Para desarrollar (recarga en caliente)

Requisitos: **Bun ≥ 1.4.1**, **Node ≥ 20.9** (`.nvmrc` fija 24), **Docker Desktop** y la **Supabase CLI** (`brew install supabase/tap/supabase`).

```bash
bun install --frozen-lockfile           # respeta bun.lock (versiones exactas)
bun run db:start                        # Supabase local: aplica migraciones y seed (Docker activo)
supabase status -o env                  # API_URL, ANON_KEY, SERVICE_ROLE_KEY
cp .env.example .env.local              # y rellenar las 4 variables (ver docs/05-guias/variables-de-entorno.md)
bun run dev                             # http://localhost:3000
```

No hay registro público: el primer admin se crea con la API de administración de Auth ([guía](docs/05-guias/setup-local.md#6-crear-usuarios-para-entrar)); los demás, invitándolos desde `/users`.
Los correos de invitación y recuperación llegan a Mailpit (<http://127.0.0.1:54324>).

Si falta una variable de entorno, `next dev` y `next build` fallan **nombrándola**. La clave `SUPABASE_SERVICE_ROLE_KEY` salta RLS: solo la usa el servidor para invitar usuarios y **nunca** debe ir en una variable `NEXT_PUBLIC_*`.

## Comandos

| Comando | Qué hace |
|---|---|
| `bun run dev` · `build` · `start` | Desarrollo, build de producción, servidor |
| `bun run check` | `typecheck` → `lint` → `test` → `build` |
| `bun run lint` · `typecheck` · `format:check` | ESLint (`--max-warnings 0`), `tsc --noEmit`, Prettier |
| `bun run test` | Unitarias + componentes + integración (necesita `db:start`) |
| `bun run test:unit` · `test:components` · `test:integration` | Cada nivel por separado |
| `bun run test:coverage` | Con umbral ≥ 80 % en `lib/server` y `lib/validation` |
| `bun run test:e2e` | Playwright contra el build de producción (`bunx playwright install chromium` una vez) |
| `bun audit` | Vulnerabilidades de dependencias |
| `bun run db:start` · `db:reset` · `db:types` | Supabase local, recrear la BD, regenerar `types/database.ts` |
| `bun run local:up` · `local:down` · `local:reset` · `local:seed` | Todo en Docker (Supabase + usuarios de prueba + app) y su semilla |

Más en [`docs/05-guias/comandos.md`](docs/05-guias/comandos.md).

## Pruebas y CI

**264 pruebas** (107 unitarias, 21 de componentes, 123 de integración contra Supabase local y 13 e2e con Playwright). Incluyen escalada de privilegios, permisos por rol, el flujo de invitación con el correo real y **concurrencia**
(dos ventas de la última unidad, ráfagas de ventas, reembolsos simultáneos), y cada protección se verificó **rompiéndola a propósito**. Las pruebas de integración **se niegan a correr contra un Supabase que no sea local**.
`.github/workflows/ci.yml` ejecuta todo en cada PR. Detalle: [testing](docs/05-guias/testing.md).

## Estructura

```
app/(auth)  app/(dashboard)   Páginas (Client Components; el layout del dashboard es Server Component)
app/api/v1                    Route Handlers (route()/publicRoute())
components/  hooks/           UI compartida; shadcn en components/ui
lib/server                    Servicios, autenticación, errores (SOLO servidor)
lib/validation  lib/api       Esquemas zod compartidos · cliente fetch del navegador
supabase/migrations           Baseline, integridad, roles/RLS, RPC, reportes  (+ seed.sql, templates/, legacy/)
Dockerfile  docker-compose.yml  La app como imagen de producción (uso local) · scripts/local-*.sh, seed-local.ts
test/  e2e/  scripts/         Pruebas y umbral de cobertura
docs/                         Documentación interna (índice en docs/README.md)
```

## Documentación

Todo está en [`docs/`](docs/README.md): arquitectura, base de datos, módulos, [auditoría técnica](docs/04-auditoria/README.md) (con el estado de cada hallazgo), guías y roadmap.
Para agentes de IA: [`AGENTS.md`](AGENTS.md) (reglas duras y trampas conocidas) y [`CLAUDE.md`](CLAUDE.md).

## Seguridad

Reglas que no se negocian (completas en [`AGENTS.md`](AGENTS.md) §6): nada que decida dinero, stock o permisos se calcula en el cliente; toda tabla nueva con RLS por rol; nunca `service_role` en el cliente;
no ejecutar SQL de escritura contra el proyecto real; no subir `.env*` ni claves. Para reportar una vulnerabilidad, contacta al propietario del repositorio en privado.

## Licencia

**Sin definir.** Este README declaraba MIT, pero el repositorio no tiene archivo `LICENSE`; la licencia está pendiente de decidir con el propietario (D20).
