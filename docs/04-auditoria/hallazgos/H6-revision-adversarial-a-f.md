# H6 — Revisión adversarial de las fases A–F (caja, cuentas por cobrar, notificaciones)

| | |
|---|---|
| **Severidad** | Alta (seguridad y dinero) a Baja, según el ID |
| **Área** | Caja y jornada, cuentas por cobrar, reportes, notificaciones, compras |
| **Esfuerzo** | Grande |
| **Estado** | Corregido — ver tabla (todo el alcance del plan, salvo M3/B9, omitido por decisión explícita del usuario). Probado en local (`fix/adversarial-a-f`, `fix/h6-pendientes`); **no aplicado a la base real** |
| **Confianza** | Lo marcado "Corregido" **[Verificado]** con pruebas de integración/E2E |

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

**Tercera pasada:** al cerrar F3/U5/U6/C6/R-E (ver `20261006000008_fix_h6_pending.sql`), una revisión adversarial
superficial (Opus) encontró 3 bloqueantes reales antes de fusionar: (1) el backfill de E2 referenciaba
`expenses.date`, columna eliminada en `20261004000001_expenses.sql`, y habría reventado la migración completa
(arrastrando F3/U5/E3, en la misma migración) contra cualquier base con zona horaria distinta de UTC — se corrigió
para recalcular desde `occurred_at` por su huella de medianoche UTC, verificado con `begin; … ; rollback;` en
local; (2) `verificar-checkout.md` y la fila F4 de esta tabla afirmaban una tolerancia de despliegue (`42703` en
`lib/server/auth.ts`, esquemas `.optional()`) que no existía en el código — se implementó de verdad; (3) el diálogo
de registrar compra (`RegisterPurchaseDialog`/`AdjustDialog` en `inventory/page.tsx`) inicializaba el producto o
proveedor con el primer resultado de una búsqueda asíncrona vacía en el montaje, dejando líneas sin producto real
o cambiando de proveedor en silencio al escribir en el buscador — corregido con selección explícita (sin
autocompletar salvo con la lista sin filtrar) y placeholder real en el `<select>`.

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
| F3 | Media, fiabilidad | Un destinatario fallido reenvía a todos | **Corregido**: cada fila del outbox guarda `payload.delivered_to` (RPC interna `_mark_outbox_delivery`); un reintento solo alcanza a los destinatarios que faltan en esa lista, no a todo el lote. `sendPush` recorre todas las suscripciones del usuario acumulando errores en vez de cortar en la primera. Sin ningún canal configurado, `dispatchOutbox` no reclama filas (D4) |
| F4 | Media, despliegue | Orden de despliegue código/migración | **Corregido**: la UI de `/cash` tolera que `close_cash_session` devuelva `null`/`void` (código nuevo contra migración vieja) sin lanzar; el orden migración→deploy y la tolerancia de `lib/server/auth.ts`/esquemas de reportes quedaron documentados en `verificar-checkout.md` §D |
| U1/R-1 | Media, negocio | El cajero veía el esperado en vivo | **Corregido**, y reforzado en la 2ª pasada: la 1ª versión solo ocultaba `expected_cash`, pero `opening_float + cash_sales + open_tab_cash + deposits − withdrawals − refunded_cash − expenses − purchases` daba el mismo número — ahora, con la caja abierta y sin ser manager+, `cash_session_summary` solo devuelve `opening_float` (nada más se filtra, ni siquiera al propio dueño de la caja) |
| A3 | Alta, seguridad | Regresión: `/cash` rompía para cualquier cajero en cuanto había otra caja abierta | **Corregido en la 2ª pasada** (bug introducido por la propia corrección de A3): `getCashDesk` llamaba `cash_session_summary` sobre TODAS las cajas abiertas de la jornada, y esa función lanza 42501 si el cajero no es responsable de una de ellas. Ahora `getCashDesk` solo llama la RPC para la caja del propio cajero (o todas, si es manager+); para las demás, muestra la caja sin `expected_cash`, sin llamar la RPC |
| U2 | Media | Editar una cuenta por cobrar borraba `reminder_note` | **Corregido**: `list_receivables` la devuelve; el diálogo la usa como valor inicial |
| U3 | Media, dinero | Idempotencia opcional en `pay_receivable`; sin idempotencia en compras | **Corregido**: cabecera `Idempotency-Key` obligatoria en `pay_receivable` (400 si falta) y en `POST /purchases`/`receive_purchase` (mismo patrón `idempotency_keys` que `create_sale`); ambos diálogos generan la clave una sola vez al abrirse y la reutilizan en reintentos |
| U4 | Media | POS acepta pagos duplicados por método; diálogo de `/receivables` no autocompleta | **Corregido**: `create_sale` rechaza dos pagos con el mismo método; el diálogo de `/receivables` (C6) reutiliza la lógica pura del POS (`lib/tab-split.ts`: `splitRemainder`/`paymentGap`) — autocompleta el restante, muestra «Falta»/«Sobra» y bloquea el envío si no cuadra o se repite el método |
| U5 | Media | Push en equipo compartido | **Corregido**: `register_push_subscription` (upsert por `endpoint`, reasigna `user_id`) sustituye el insert directo que daba 409; el logout desuscribe el push del navegador antes de cerrar sesión; el interruptor de push refleja si el navegador tiene de verdad una suscripción, no solo la preferencia guardada; `sw.js` escucha `pushsubscriptionchange` |
| U6 | Media | Variables de entorno de correo/push acopladas | **Corregido**: dos grupos independientes en `lib/env/schema.ts` (correo: `RESEND_API_KEY`+`EMAIL_FROM`; push: los tres `VAPID_*`), cada uno opcional por separado; `VAPID_SUBJECT` valida el prefijo `mailto:`/`https://` |
| B1/E1 | Baja | Índices, `unit_cost` de variantes, `ORDER_STATUSES`, locks de compra | **Corregido**: `unit_cost` con variante; `ORDER_STATUSES` incluye `written_off`; índices de C3; `receive_purchase` bloquea inventario en orden determinista y rechaza proveedor eliminado (E1). Resto de R-E: E2 (backfill de zona horaria de `expenses.occurred_at`, solo filas sin tocar desde el backfill anterior), E3 (`_purge_outbox`, cron diario), E4 (campana usa `low_stock_count` de `GET /dashboard`, no el inventario completo, y refresca al cambiar de ruta), E5 (selectores de proveedor/producto en compras buscan contra la API con `q` en vez de `pageSize: 100`), E6 (título «Cuenta por cobrar registrada» al diferir, botón con `OfflineDisabledButton`), E7 (sumas del ticket pendiente y de `customers/[id]` en unidades mínimas, `lib/tab-split.ts: sumMoney`) |
| T* | Alta, pruebas | Concurrencia mockeada, sin pruebas de RLS directa | **Corregido**: solo M8/M9 (vía B2/B4) son condiciones de carrera reales y tienen prueba ×20 rompiendo la protección; ahora se suma `_claim_outbox` con **dos conexiones Postgres reales** (`Bun.SQL`, `test/integration/outbox-claim-pg.test.ts`, ×20: una transacción se mantiene abierta sin commit mientras la otra reclama). `mock.module('resend'\|'web-push')` se aisló en `test/integration/notifications-dispatch.test.ts`, con su propio proceso `bun test` y variables de entorno restauradas con `try/finally` (antes se filtraban al resto de `test/integration`). E2E añadidos: pago dividido + imprimir, gasto en efectivo baja el esperado, compra sube el stock, diferir → aparece en `/receivables` → pagar → desaparece. Pruebas nuevas de F3 (reintento no reenvía a quien ya recibió), D4 (sin claves, las filas quedan sin reclamar) |

## Qué se verificó y no se tocó

Las redefiniciones de `create_sale`, `_close_tab`, `tab_pay`/`tab_pay_split`, `sales_report` y `business_day_report`
mantuvieron su lógica de negocio previa salvo el cambio puntual descrito; revoke/grant de todas las funciones;
roles de rutas iguales a las RPC; i18n ES/EN; cola offline compatible con entradas antiguas.

## Migraciones

`20261006000001_fix_security.sql` (R-A) → `20261006000002_fix_cash.sql` (R-B, sin B9) →
`20261006000004_fix_reports.sql` (R-C) → `20261006000005_fix_outbox.sql` (R-D) →
`20261006000007_fix_adversarial_review.sql` (correcciones de la 2ª pasada: P1-a/b/c, `close_business_day`,
`_current_assignment`, outbox, `sales_report`/`business_day_report`, `create_sale` (B7), `receive_purchase`
(idempotencia + E1)) → `20261006000008_fix_h6_pending.sql` (F3: `_mark_outbox_delivery`; U5:
`register_push_subscription`; E3: `_purge_outbox`; E2: backfill de `expenses.occurred_at`). R-E queda completo
(E1–E7). Ninguna migración se ha aplicado a la base real.

## Pendiente

Nada del alcance de este documento (§1–§5 del plan) queda pendiente. Fuera de alcance por decisión explícita del
usuario: M3/B9 (backfill de `orders.status` legado, dependía de la consulta de solo lectura del §2 del plan, que
nunca se ejecutó contra el proyecto real). Fuera de alcance por el propio plan (§3, "Fuera de alcance"): i18n de
los textos de correo/push, paginación de `list_receivables` más allá del límite de A1, el N+1 de `getCashDesk`,
`skipWaiting` del service worker, y crear un producto con umbral de forma atómica.
