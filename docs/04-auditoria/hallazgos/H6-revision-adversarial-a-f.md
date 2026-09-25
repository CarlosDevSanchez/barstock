# H6 — Revisión adversarial de las fases A–F (caja, cuentas por cobrar, notificaciones)

| | |
|---|---|
| **Severidad** | Alta (seguridad y dinero) a Baja, según el ID |
| **Área** | Caja y jornada, cuentas por cobrar, reportes, notificaciones, compras |
| **Esfuerzo** | Grande |
| **Estado** | Parcial — ver tabla. Corregido y probado en local (`fix/adversarial-a-f`); **no aplicado a la base real** |
| **Confianza** | Lo marcado "Corregido" **[Verificado]** con pruebas de integración; lo marcado "No implementado" es hallazgo sin corregir |

## Contexto

Tres revisiones adversariales en paralelo (SQL, servidor/UI y pruebas) sobre las fases D, E y F (`feat/pendiente`)
encontraron fallos de dinero, seguridad, fiabilidad y pruebas. El plan de corrección completo está en
`~/.claude/plans/necesito-realizar-un-planteamiento-tidy-donut.md`. El usuario decidió explícitamente **omitir B9**
(la migración de órdenes `pending` antiguas, que dependía de un conteo de solo lectura contra el proyecto real que
nunca se ejecutó) — no es un hallazgo pendiente, es una decisión consciente de no tocarlo por ahora.

**Segunda pasada:** una revisión adversarial independiente de la primera corrección encontró 3 bloqueantes reales
(una regresión que rompía `/cash` para cualquier cajero en cuanto había otra caja abierta; el arqueo a ciegas que
solo ocultaba `expected_cash` pero dejaba sumar el resto de campos para derivarlo igual; y un reembolso que se
imputaba a la caja del gerente en vez de a la caja original del pago) más varios hallazgos P2 (una condición de
carrera adicional en `close_business_day`, un ajuste de pagos que podía colapsar dos pagos no-efectivo en uno, un
`net_profit` que sumaba impuesto de más, doble conteo en `business_day_report`, y varios más — ver tabla). Esta
segunda pasada también encontró que el informe original afirmaba pruebas de concurrencia ×20 "rompiendo la
protección" en más hallazgos de los que realmente las tenían; la tabla de abajo es la versión corregida.

## Estado por hallazgo

| ID | Severidad | Hallazgo | Estado |
|---|---|---|---|
| S1 | Alta, seguridad | `list_receivables` acepta cualquier `p_status` | **Corregido**: allowlist `null`/`pending`/`written_off`, límite 1–500, devuelve `reminder_note` |
| S2 | Alta, seguridad | SSRF en suscripciones push (`endpoint` sin restricción) | **Corregido**: allowlist de hosts, `https:` obligatorio, revalidado también al despachar, timeout 10 s. `deletePushSubscriptionSchema` NO aplica la allowlist (una suscripción de un host ya no soportado debe poder borrarse) |
| M1 | Alta, dinero | `_current_assignment` ignora `p_at` | **Corregido**, y reforzado en la 2ª pasada: la caja debe además pertenecer a la MISMA jornada elegida para ese instante, no solo caer en su ventana horaria |
| M2/B3 | Alta, dinero | Un reembolso se resta de la caja del refund_order, no de la caja original del pago | **Corregido en la 2ª pasada** (la 1ª versión estaba mal: usaba `_current_assignment` del usuario que reembolsa, así que un gerente sin caja propia, o con una caja distinta, imputaba el reembolso a un lugar equivocado). Ahora: el reembolso se resta de la caja **original del pago** (`payments.cash_session_id`, único posible dado que los métodos duplicados están bloqueados) **si sigue abierta**; si ya cerró, no se resta de ninguna caja y la orden queda con `refund_after_close = true` para revisión |
| M3 | Alta, datos | Órdenes `pending` antiguas aparecen como cuentas por cobrar | **Omitido por decisión del usuario** (dependía del conteo de solo lectura del §2 del plan, nunca ejecutado; no se tocó `orders.status` ni se escribió la migración de backfill) |
| M4/B7 | Media, dinero | Ajuste offline de pagos mixtos podía borrar un pago con tarjeta ya cobrado | **Corregido**, y reforzado en la 2ª pasada: el drenaje es determinista (efectivo primero si existe; si no, el ÚLTIMO pago) y nunca colapsa dos pagos no-efectivo en uno salvo que drenar ambos siga sin alcanzar el total. `payment_adjusted` ahora registra los arreglos `before`/`after` completos, no solo el escalar tocado |
| M5/C1 | Media, dinero | `net_profit` restaba el total entero de las `written_off` | **Corregido**, y reforzado en la 2ª pasada: el pago cobrado que se suma a `net_profit` se descuenta de su impuesto proporcional (antes sumaba el bruto, inconsistente con el resto de `net_profit`, que es antes de impuesto) |
| M6/C2 | Media, dinero | `pay_receivable` sin jornada abierta ponía `business_day_id = null` | **Corregido**, y reforzado en la 2ª pasada: `business_day_report` solo cae a `settled_at` para órdenes SIN `business_day_id` (antes una orden con día propio también podía colar por `settled_at` en el reporte de OTRO día, contándose dos veces entre reportes) |
| M7/B6 | Media, dinero | Anular un gasto/compra en efectivo subía el esperado aunque la caja estuviera cerrada | **Corregido**: columna `voided_after_close`; `_session_cash` ignora esas anulaciones para cajas ya cerradas |
| M8/B4 | Media, concurrencia | `close_business_day` cerraba cajas antes de bloquear la jornada | **Corregido**, con prueba de concurrencia real ×20 (`for update`/`for share`, rompiendo la protección una vez). Encontró y corrigió DOS bugs reales durante la implementación: (1) `now()` congelado en la transacción podía preceder al `opened_at` real de una caja creada por la transacción ganadora de la carrera, violando `cash_sessions_closed_after_open`; (2) `expected_cash = _session_cash(...)` se calculaba en la MISMA sentencia que el lock, así que un movimiento concurrente que entrara justo tras el lock podía perderse — ahora se bloquean todas las cajas abiertas en una sentencia propia y `_session_cash` se calcula después, por fila |
| M9/B2 | Media, concurrencia | Una venta concurrente con `close_cash_session` podía quedar en una caja ya cerrada | **Corregido**, con prueba de concurrencia real ×20. `create_sale`, `_create_order_from_tab`, `tab_pay`, `tab_pay_split` y `pay_receivable` re-verifican con `for share` tras `_current_assignment` |
| M10/B5 | Media, datos | `adjust_business_day` no reasignaba `expenses`/`purchase_orders`/`cash_sessions`, aceptaba fechas inválidas | **Corregido**: rechaza cierre futuro y solapes; reasigna las tres tablas (con `coalesce(...,p_id)` para `cash_sessions`, que es `NOT NULL`); pagos reasignados por la fecha de su orden |
| F1/D1 | Alta, fiabilidad | `afterResponse` no devolvía la promesa a `after()` | **Corregido**: `nextAfter(() => task())` sin `void` ni envoltura |
| F2/D2 | Alta, fiabilidad | `_claim_outbox` no volvía a reclamar filas atascadas | **Corregido**, y reforzado en la 2ª pasada: `_claim_outbox` ahora también incrementa `attempts` al reclamar (antes solo `markFailure` lo hacía, así que una fila que solo se reclamaba y nunca fallaba explícitamente podía reclamarse cada 10 min para siempre sin agotar el límite); `_enqueue_due_receivables` no encola un segundo recordatorio mientras el de un día anterior siga sin procesar |
| F3 | Media, fiabilidad | Un destinatario fallido reenvía a todos | No implementado |
| F4 | Media, despliegue | Orden de despliegue código/migración | **Parcial**: la UI de `/cash` tolera que `close_cash_session` devuelva `null`/`void` (código nuevo contra migración vieja) sin lanzar; falta documentar el orden migración→deploy en `verificar-checkout.md` |
| U1/R-1 | Media, negocio | El cajero veía el esperado en vivo | **Corregido**, y reforzado en la 2ª pasada: la 1ª versión solo ocultaba `expected_cash`, pero `opening_float + cash_sales + open_tab_cash + deposits − withdrawals − refunded_cash − expenses − purchases` daba el mismo número — ahora, con la caja abierta y sin ser manager+, `cash_session_summary` solo devuelve `opening_float` (nada más se filtra, ni siquiera al propio dueño de la caja) |
| A3 | Alta, seguridad | Regresión: `/cash` rompía para cualquier cajero en cuanto había otra caja abierta | **Corregido en la 2ª pasada** (bug introducido por la propia corrección de A3): `getCashDesk` llamaba `cash_session_summary` sobre TODAS las cajas abiertas de la jornada, y esa función lanza 42501 si el cajero no es responsable de una de ellas. Ahora `getCashDesk` solo llama la RPC para la caja del propio cajero (o todas, si es manager+); para las demás, muestra la caja sin `expected_cash`, sin llamar la RPC |
| U2 | Media | Editar una cuenta por cobrar borraba `reminder_note` | **Corregido**: `list_receivables` la devuelve; el diálogo la usa como valor inicial |
| U3 | Media, dinero | Idempotencia opcional en `pay_receivable`; sin idempotencia en compras | **Corregido**: cabecera `Idempotency-Key` obligatoria en `pay_receivable` (400 si falta) y en `POST /purchases`/`receive_purchase` (mismo patrón `idempotency_keys` que `create_sale`); ambos diálogos generan la clave una sola vez al abrirse y la reutilizan en reintentos |
| U4 | Media | POS acepta pagos duplicados por método; diálogo de `/receivables` no autocompleta | **Parcial**: `create_sale` rechaza dos pagos con el mismo método; el diálogo de `/receivables` no se tocó (C6) |
| U5 | Media | Push en equipo compartido | No implementado |
| U6 | Media | Variables de entorno de correo/push acopladas | No implementado |
| B1/E1 | Baja | Índices, `unit_cost` de variantes, `ORDER_STATUSES`, locks de compra | **Parcial**: `unit_cost` con variante; `ORDER_STATUSES` incluye `written_off`; índices de C3; `receive_purchase` ahora bloquea inventario en orden determinista (por `product_id`) y rechaza proveedor eliminado. El resto de R-E (backfill de zona horaria, purga de outbox, campana de stock, selectores con búsqueda, textos de diferir, saldos en unidades mínimas) no se tocó |
| T* | Alta, pruebas | Concurrencia mockeada, sin pruebas de RLS directa | **Parcial, corregido de una afirmación falsa en la 1ª versión de este documento**: solo M8/M9 (vía B2/B4) tienen pruebas de concurrencia real ×20 rompiendo la protección — son los únicos hallazgos que son, en efecto, condiciones de carrera. M1, M2, M4, M7, S1 y A3 son comprobaciones de lógica/autorización deterministas (no carreras) y tienen pruebas de escenario único, que es lo que corresponde a su naturaleza. Añadidas: SSRF (`http://10.0.0.1`, `https://evil.com` → 422), usuario inactivo → 42501 en toda RPC nueva, `_claim_outbox`/`_enqueue_due_receivables`/`_current_assignment`/`_session_cash`/`_auto_close_stale_business_days` como `authenticated` → error. Falta: F3, D3–D9, E2E adicionales, `_claim_outbox` con dos conexiones `pg` reales, aislar `mock.module('resend'\|'web-push')` en su propio proceso |

## Qué se verificó y no se tocó

Las redefiniciones de `create_sale`, `_close_tab`, `tab_pay`/`tab_pay_split`, `sales_report` y `business_day_report`
mantuvieron su lógica de negocio previa salvo el cambio puntual descrito; revoke/grant de todas las funciones;
roles de rutas iguales a las RPC; i18n ES/EN; cola offline compatible con entradas antiguas.

## Migraciones

`20261006000001_fix_security.sql` (R-A) → `20261006000002_fix_cash.sql` (R-B, sin B9) →
`20261006000004_fix_reports.sql` (R-C) → `20261006000005_fix_outbox.sql` (R-D) →
`20261006000007_fix_adversarial_review.sql` (correcciones de la 2ª pasada: P1-a/b/c, `close_business_day`,
`_current_assignment`, outbox, `sales_report`/`business_day_report`, `create_sale` (B7), `receive_purchase`
(idempotencia + E1)). No hay migración R-E completa. Ninguna se ha aplicado a la base real.

## Pendiente

F3, U5, U6, C6, la mayor parte de R-E (E2–E7), y la matriz completa de pruebas del §4 del plan (E2E adicionales,
`_claim_outbox` con dos conexiones `pg` reales, aislamiento de `mock.module` de notificaciones en su propio
proceso). Documentación pendiente en el mismo detalle: `docs/02-base-de-datos/*` (columnas nuevas
`refund_cash_session_id`, `refund_after_close`, `voided_after_close`), `verificar-checkout.md` (orden
migración→deploy), `notificaciones.md`, `cuentas-por-cobrar.md` (idempotencia obligatoria).
