# Plan de remediación

> Basado en la [auditoría](../04-auditoria/README.md) (commit `54962b9`). Las duraciones son **estimaciones orientativas** para una persona
> con conocimiento del stack; no son compromisos. Marcar las casillas al avanzar y reflejar el estado en la tabla de hallazgos.

## Estado tras la etapa 1

La etapa 1 (rama `feat/etapa-1-base`) ejecutó lo que se podía hacer **en desarrollo**. Leyenda: `[x]` hecho y probado en local · `[ ]` pendiente. **Nada se ha aplicado a la base real ni se ha desplegado**: lo que toca producción sigue pendiente a propósito
(paso controlado: backup, comprobaciones de [`verificar-checkout.md`](../05-guias/verificar-checkout.md), `db pull` para comparar, invitar usuarios antes de cerrar el registro).

**Pendiente, en orden sugerido:** (1) aplicar las migraciones a staging y luego a producción, (2) primera ejecución real del CI y regla de rama protegida, (3) validar con el negocio las reglas D3/D6/D7/D9,
(4) monitoreo de errores, (5) etapa 2: órdenes de compra, gastos, variantes en el POS, recibo.

## Principios

1. **Seguridad de datos antes que funciones nuevas.** Sin RLS por rol, todo lo demás se construye sobre arena.
2. **Reglas de negocio en la base de datos.** El cliente solo presenta; el servidor decide precios, impuestos, stock y permisos.
3. **Cambios pequeños y verificables.** Cada fase termina con criterios de aceptación comprobables y pruebas.
4. **Migrar datos existentes con cuidado** (ver "Riesgos de la migración").
5. **Documentar en el mismo PR** que cambia el comportamiento.

## Mapa hallazgo → fase

| Hallazgo | Fase |
|---|---|
| C3 dependencias, H5 env/build | 0 |
| C1 RLS, C2 checkout, M1–M4 BD, M14 formularios | 1 |
| H1 sesión/servidor, H2 validación, H3 impuestos, H4 flujos | 2 |
| M5, M6, M17 rendimiento/reportes; M7 capa de datos; M9 headers; M13 tests/CI/monitoreo | 3 |
| M8, M10–M12, M15, M16, M18 calidad y pulido | 4 |

---

## Fase 0 — Contención (½–1 día)

Objetivo: reducir el riesgo inmediato sin cambiar la arquitectura.

- [ ] **Inspeccionar Supabase:** ¿*Enable sign ups*? ¿*Confirm email*? ¿*Anonymous sign-ins*? ¿plan y backups? Anotar en [`02-base-de-datos/06-seed-y-migraciones.md`](../02-base-de-datos/06-seed-y-migraciones.md). — pendiente (producción)
- [ ] **Cerrar el registro público** (o exigir confirmación de email y aprobación) mientras no exista RLS por rol. — cerrado en `config.toml` local; **falta en el proyecto real** (y crear las invitaciones antes)
- [ ] **Snapshot/backup manual** de la base antes de tocar nada. — pendiente (producción)
- [x] **Actualizar Next** a `16.3.5` y `eslint-config-next`; `npm audit fix` ([C3](../04-auditoria/hallazgos/C3-dependencias-vulnerables.md)). — Next 16.3.5, `bun audit` limpio
- [x] `lib/env.ts` con zod, `.env.example` versionado, Node fijado ([H5](../04-auditoria/hallazgos/H5-build-sin-env.md)). — `lib/env/*`, `.env.example`, `.nvmrc`
- [ ] Ejecutar [`verificar-checkout.md`](../05-guias/verificar-checkout.md) en staging y anotar resultados en C2/M14. — la guía se reescribió; ejecutarla en staging antes de migrar
- [ ] Ejecutar las consultas de integridad en producción (solo lectura) para medir el daño ya existente (stock negativo, órdenes huérfanas, duplicados). — pendiente (producción, solo lectura)

**Aceptación:** `npm audit --audit-level=high` limpio; registro cerrado; build reproducible con variables; hipótesis de C2 confirmadas o descartadas.

## Fase 1 — Seguridad de datos e integridad del cobro (1–2 semanas)

Objetivo: cerrar C1 y C2 en la base de datos.

**1.1 Línea base de migraciones** ([M4](../04-auditoria/hallazgos/medios-y-bajos.md))
- [ ] Supabase CLI: `init`, `link`, `db pull` → migración `0001_baseline` con el estado real. — `init` y baseline desde `schema.sql` hechos; **`link` y `db pull` contra producción pendientes** para comparar
- [ ] Proyecto de **staging** clonado desde la baseline. — pendiente (existe el entorno local reproducible)

**1.2 Modelo de permisos** ([C1](../04-auditoria/hallazgos/C1-rls-permisivo.md))
- [x] `current_app_role()` (`SECURITY DEFINER`, `search_path=''`).
- [x] Trigger que protege `profiles.role`. — también protege el último admin
- [x] Reemplazar las políticas `authenticated` por políticas por rol ([matriz](../02-base-de-datos/03-rls-y-politicas.md#matriz-efectiva)).
- [x] Revocar `INSERT/UPDATE/DELETE` directos en `orders`, `order_items`, `payments`, `inventory`, `inventory_transactions`.
- [x] Pruebas SQL por rol (cajero/gerente/admin). — `rls.test.ts` (automatizadas, con `supabase-js` por rol)

**1.3 RPC transaccionales** ([C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md))
- [x] Secuencia para `order_number`.
- [x] `create_sale`, `refund_order`, `adjust_inventory` ([borrador](diseno-objetivo-seguridad.md)).
- [x] Refactor del POS y del detalle de orden para usarlas (el cliente envía ids y cantidades).
- [x] Trigger/inserción automática de inventario al crear producto.

**1.4 Restricciones de datos** ([M1–M3](../04-auditoria/hallazgos/medios-y-bajos.md))
- [x] `CHECK` (`quantity >= 0`, precios/importes `>= 0`, coherencia de totales) — con `NOT VALID` y luego `VALIDATE` tras limpiar datos. — los dos aritméticos siguen `NOT VALID`: falta `VALIDATE` en la base real
- [x] Índice único parcial de inventario; índices faltantes; `NOT NULL` en FKs de pertenencia.

**1.5 Formularios** ([M14](../04-auditoria/hallazgos/medios-y-bajos.md))
- [x] `''` → `null` en `barcode`, `category_id`, `email` (parche mínimo, antes de zod). — en los esquemas zod

**Aceptación:** los criterios de C1 y C2; tests SQL en verde; ninguna escritura financiera posible por API directa.

## Fase 2 — Servidor, validación y flujos (2–3 semanas)

- [x] **H1:** `@supabase/ssr`, `proxy.ts`, guard por rol, `onAuthStateChange`, limpiar carrito en logout. — `proxy.ts` y `route()`; no hay `onAuthStateChange` porque el navegador no usa `supabase-js`
- [x] **H2:** `lib/validation/` con zod; `react-hook-form` en los diálogos; mensajes de error controlados.
- [ ] **H3:** decidir regla fiscal ([D3](decisiones-pendientes.md)); `tax_rate NUMERIC(6,4)`; cálculo solo en RPC; un único origen de la tasa. — cálculo único en `create_sale` y `NUMERIC(6,4)` hechos; **la regla fiscal D3 sigue sin validar** con contabilidad
- [ ] **H4:** `/reset-password`; ajustes persistidos en `settings`; pantalla de inventario con recepción/ajuste; órdenes de compra; edición de clientes/proveedores; recibo imprimible. — hechos `/reset-password`, ajustes persistidos y ajuste de inventario; **faltan** órdenes de compra, edición de clientes/proveedores en la UI y recibo imprimible
- [x] Registro: invitación o aprobación; quitar el selector de rol.

**Aceptación:** criterios de H1–H4.

## Fase 3 — Rendimiento, calidad y operación (2–3 semanas)

- [x] Vistas/RPC agregadas para dashboard y reportes; zona horaria del negocio ([M6, M17](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [x] Paginación por rango y búsqueda en servidor ([M5](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [x] `lib/data/*` y tipos generados (`supabase gen types`) → eliminar `any` ([M7, M10](../04-auditoria/hallazgos/medios-y-bajos.md)). — servicios en `lib/server/services`, tipos generados, sin `any`
- [x] **Tests:** Vitest (esquemas, cálculos), pruebas de RPC, Playwright del flujo de venta y reembolso ([M13](../04-auditoria/hallazgos/medios-y-bajos.md)). — con `bun test` y Playwright en lugar de Vitest; 264 pruebas
- [x] **CI (GitHub Actions):** `.github/workflows/ci.yml` (frozen install, format, lint, typecheck, audit, tests con cobertura, build, e2e). Falta la primera ejecución real y la regla de rama protegida.
- [x] **Headers de seguridad** en `next.config.ts` ([M9](../04-auditoria/hallazgos/medios-y-bajos.md)). — la CSP conserva `'unsafe-inline'` en scripts
- [ ] **Sentry** (o equivalente) y logs estructurados; alertas de errores del checkout. — pendiente
- [x] Dependabot (`.github/dependabot.yml`).

**Aceptación:** CI verde y obligatorio; cobertura ≥ 80 % en lógica de negocio crítica; dashboard en 1–2 consultas.

## Fase 4 — Pulido (continuo)

- [ ] Accesibilidad ([M15](../04-auditoria/hallazgos/medios-y-bajos.md)), `AlertDialog`, componentes compartidos (`SidebarNav`, `UserMenu`, `LoadingSpinner`). — `aria-label`, `htmlFor` y `ConfirmDialog` hechos; **falta** auditoría con axe/Lighthouse y extraer `SidebarNav`/`UserMenu`
- [ ] Limpiar código muerto y lint ([M11](../04-auditoria/hallazgos/medios-y-bajos.md)). — lint en 0; quedan `components/ui/tabs.tsx` y los SVG de `public/`
- [x] `SET search_path` en funciones ([M16](../04-auditoria/hallazgos/medios-y-bajos.md)). — en las funciones nuevas; se mantiene `uuid_generate_v4()`
- [ ] Reescribir README y añadir `LICENSE` ([M12](../04-auditoria/hallazgos/medios-y-bajos.md)). — README reescrito; **falta `LICENSE`** (D20)
- [ ] Runbooks: backup/restore, incidente en caja, rotación de claves. — pendiente

---

## Riesgos de la migración

| Riesgo | Mitigación |
|---|---|
| Datos existentes violan los nuevos `CHECK`/índices (stock negativo, duplicados de inventario, totales que no cuadran) | Consultas de integridad primero; corregir datos; `ADD CONSTRAINT … NOT VALID` y luego `VALIDATE CONSTRAINT` |
| Revocar escrituras directas rompe el POS actual | Desplegar RPC + nuevo cliente **antes** de revocar; feature flag o despliegue coordinado |
| Órdenes históricas con totales calculados por el cliente | No recalcular; marcar como "legacy" si hace falta; no mezclar en reportes sin revisar |
| Cambio de `tax_rate` a `NUMERIC(6,4)` | Migrar valores (`0.10` se conserva); revisar la interfaz que hoy usa `step=0.01` |
| Cierre del registro deja sin acceso a usuarios legítimos | Crear los usuarios necesarios (invitaciones) antes de cerrarlo |
| Migración de sesión a cookies (H1) cierra sesiones activas | Comunicar; hacerlo fuera de horario de caja |

## Definición de "hecho" por hallazgo

Un hallazgo pasa a **Corregido** cuando se cumplen sus criterios de aceptación y está mergeado; a **Verificado** cuando además se
comprobó en staging (y, si aplica, en producción) y se actualizó la documentación afectada.
