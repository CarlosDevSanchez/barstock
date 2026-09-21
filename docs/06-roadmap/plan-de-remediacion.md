# Plan de remediación

> Basado en la [auditoría](../04-auditoria/README.md) (commit `54962b9`). Las duraciones son **estimaciones orientativas** para una persona
> con conocimiento del stack; no son compromisos. Marcar las casillas al avanzar y reflejar el estado en la tabla de hallazgos.

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

- [ ] **Inspeccionar Supabase:** ¿*Enable sign ups*? ¿*Confirm email*? ¿*Anonymous sign-ins*? ¿plan y backups? Anotar en [`02-base-de-datos/06-seed-y-migraciones.md`](../02-base-de-datos/06-seed-y-migraciones.md).
- [ ] **Cerrar el registro público** (o exigir confirmación de email y aprobación) mientras no exista RLS por rol.
- [ ] **Snapshot/backup manual** de la base antes de tocar nada.
- [ ] **Actualizar Next** a `16.3.5` y `eslint-config-next`; `npm audit fix` ([C3](../04-auditoria/hallazgos/C3-dependencias-vulnerables.md)).
- [ ] `lib/env.ts` con zod, `.env.example` versionado, Node fijado ([H5](../04-auditoria/hallazgos/H5-build-sin-env.md)).
- [ ] Ejecutar [`verificar-checkout.md`](../05-guias/verificar-checkout.md) en staging y anotar resultados en C2/M14.
- [ ] Ejecutar las consultas de integridad en producción (solo lectura) para medir el daño ya existente (stock negativo, órdenes huérfanas, duplicados).

**Aceptación:** `npm audit --audit-level=high` limpio; registro cerrado; build reproducible con variables; hipótesis de C2 confirmadas o descartadas.

## Fase 1 — Seguridad de datos e integridad del cobro (1–2 semanas)

Objetivo: cerrar C1 y C2 en la base de datos.

**1.1 Línea base de migraciones** ([M4](../04-auditoria/hallazgos/medios-y-bajos.md))
- [ ] Supabase CLI: `init`, `link`, `db pull` → migración `0001_baseline` con el estado real.
- [ ] Proyecto de **staging** clonado desde la baseline.

**1.2 Modelo de permisos** ([C1](../04-auditoria/hallazgos/C1-rls-permisivo.md))
- [ ] `current_app_role()` (`SECURITY DEFINER`, `search_path=''`).
- [ ] Trigger que protege `profiles.role`.
- [ ] Reemplazar las políticas `authenticated` por políticas por rol ([matriz](../02-base-de-datos/03-rls-y-politicas.md#matriz-objetivo-propuesta-no-aplicada)).
- [ ] Revocar `INSERT/UPDATE/DELETE` directos en `orders`, `order_items`, `payments`, `inventory`, `inventory_transactions`.
- [ ] Pruebas SQL por rol (cajero/gerente/admin).

**1.3 RPC transaccionales** ([C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md))
- [ ] Secuencia para `order_number`.
- [ ] `create_sale`, `refund_order`, `adjust_inventory` ([borrador](diseno-objetivo-seguridad.md)).
- [ ] Refactor del POS y del detalle de orden para usarlas (el cliente envía ids y cantidades).
- [ ] Trigger/inserción automática de inventario al crear producto.

**1.4 Restricciones de datos** ([M1–M3](../04-auditoria/hallazgos/medios-y-bajos.md))
- [ ] `CHECK` (`quantity >= 0`, precios/importes `>= 0`, coherencia de totales) — con `NOT VALID` y luego `VALIDATE` tras limpiar datos.
- [ ] Índice único parcial de inventario; índices faltantes; `NOT NULL` en FKs de pertenencia.

**1.5 Formularios** ([M14](../04-auditoria/hallazgos/medios-y-bajos.md))
- [ ] `''` → `null` en `barcode`, `category_id`, `email` (parche mínimo, antes de zod).

**Aceptación:** los criterios de C1 y C2; tests SQL en verde; ninguna escritura financiera posible por API directa.

## Fase 2 — Servidor, validación y flujos (2–3 semanas)

- [ ] **H1:** `@supabase/ssr`, `proxy.ts`, guard por rol, `onAuthStateChange`, limpiar carrito en logout.
- [ ] **H2:** `lib/validation/` con zod; `react-hook-form` en los diálogos; mensajes de error controlados.
- [ ] **H3:** decidir regla fiscal ([D3](decisiones-pendientes.md)); `tax_rate NUMERIC(6,4)`; cálculo solo en RPC; un único origen de la tasa.
- [ ] **H4:** `/reset-password`; ajustes persistidos en `settings`; pantalla de inventario con recepción/ajuste; órdenes de compra; edición de clientes/proveedores; recibo imprimible.
- [ ] Registro: invitación o aprobación; quitar el selector de rol.

**Aceptación:** criterios de H1–H4.

## Fase 3 — Rendimiento, calidad y operación (2–3 semanas)

- [ ] Vistas/RPC agregadas para dashboard y reportes; zona horaria del negocio ([M6, M17](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [ ] Paginación por rango y búsqueda en servidor ([M5](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [ ] `lib/data/*` y tipos generados (`supabase gen types`) → eliminar `any` ([M7, M10](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [ ] **Tests:** Vitest (esquemas, cálculos), pruebas de RPC, Playwright del flujo de venta y reembolso ([M13](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [x] **CI (GitHub Actions):** `.github/workflows/ci.yml` (frozen install, format, lint, typecheck, audit, tests con cobertura, build, e2e). Falta la primera ejecución real y la regla de rama protegida.
- [ ] **Headers de seguridad** en `next.config.ts` ([M9](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [ ] **Sentry** (o equivalente) y logs estructurados; alertas de errores del checkout.
- [x] Dependabot (`.github/dependabot.yml`).

**Aceptación:** CI verde y obligatorio; cobertura ≥ 80 % en lógica de negocio crítica; dashboard en 1–2 consultas.

## Fase 4 — Pulido (continuo)

- [ ] Accesibilidad ([M15](../04-auditoria/hallazgos/medios-y-bajos.md)), `AlertDialog`, componentes compartidos (`SidebarNav`, `UserMenu`, `LoadingSpinner`).
- [ ] Limpiar código muerto y lint ([M11](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [ ] `SET search_path` en funciones ([M16](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [ ] Reescribir README y añadir `LICENSE` ([M12](../04-auditoria/hallazgos/medios-y-bajos.md)).
- [ ] Runbooks: backup/restore, incidente en caja, rotación de claves.

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
