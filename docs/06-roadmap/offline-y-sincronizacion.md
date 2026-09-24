# Plan: cola offline y sincronización

> Estado: F0 (idempotencia de `create_sale`), F1 (instantánea del catálogo del POS), F2 (el servidor recibe una
> venta offline), F3 (outbox + motor de sincronización del cliente) y F4 (UI: ticket provisional, centro de
> sincronización, revisión de gerente para `sync_issues`) están **implementadas**: cobrar sin red funciona de punta
> a punta, con feedback visible en cada paso. Complementa [PWA y modo offline](../01-arquitectura/09-pwa-offline.md).
> Referencia: D16 en [decisiones-pendientes](decisiones-pendientes.md). F5 (esta documentación) es este mismo
> documento, ya al día.
>
> **Decisiones tomadas (2026-09-22):** alcance v1 = solo ventas nuevas del POS (cuentas abiertas, ajustes de
> inventario y reembolsos siguen deshabilitados sin red); sin stock al sincronizar → se registra la venta y se marca
> para revisión, nunca se rechaza; ventana offline configurable (`settings.offline_max_hours`, 12 h por defecto).

## 1. Idempotencia primero (hace falta incluso sin offline) — ✅ Corregido para `create_sale`

> El diseño original de esta sección (`client_ref uuid unique` en `orders`/`tab_items`/`tab_payments`/
> `inventory_transactions`) tenía un error: `create_sale` puede insertar **varias** filas de `order_items` e
> `inventory_transactions` en una sola llamada (paquetes de promoción), así que una columna única por fila no puede
> representar "esta llamada ya se hizo". Implementado con una tabla aparte en su lugar (migración
> `20260927000001_idempotency.sql`):

- Tabla `idempotency_keys(key uuid PK, user_id, action, request_hash, result jsonb, created_at)`, RLS activada y sin
  políticas (solo la usan las RPC `SECURITY DEFINER`).
- `create_sale` gana `p_idempotency_key uuid default null` (firma antigua eliminada con `drop function`, grants
  rehechos). Con clave: inserta una fila de reclamo (`on conflict (key) do nothing`, así una petición concurrente con
  la misma clave espera en el índice único a que la primera termine); si la clave ya existía con el mismo
  `user_id`/payload y ya tiene `result`, devuelve la orden en vez de cobrar otra vez; con un payload distinto o sin
  `result` responde un conflicto (`errcode 'BS409'` → 409). Si la transacción falla, la fila de reclamo se revierte
  con ella y un reintento con la misma clave vuelve a evaluar la venta.
- El cliente manda la clave en la cabecera `Idempotency-Key` (`POST /api/v1/sales`), generada una vez por intento de
  cobro en el POS. Ver [pos-checkout](../03-modulos/pos-checkout.md).
- Pendiente, no bloqueante: limpieza de claves con más de unos días (tarea manual o `pg_cron`, **[Por verificar]** en
  el plan de Supabase).
- **Fuera de este alcance:** `tab_add_items`, `tab_pay` y `adjust_inventory` todavía no tienen protección de
  idempotencia; el mismo patrón (tabla `idempotency_keys`, ya creada) sirve para ellos cuando se necesite.

## 2. Instantánea del catálogo del POS — ✅ Implementada

El diseño original de este documento asumía un "precio provisional con la última foto vista", pero la caché del
service worker indexa por URL+query exacta: una búsqueda nueva sin red simplemente no tenía de dónde salir. Corregido
con una instantánea explícita, sin esperar al resto de la cola:

- `GET /api/v1/pos/snapshot` (`lib/server/services/pos.ts`) devuelve de una vez los productos y promociones activos,
  las categorías y los clientes activos, sin paginar (tope 2000 filas por tabla), en la misma forma que `/products` y
  `/promotions`.
- `lib/offline/db.ts`: envoltorio mínimo de IndexedDB con dos stores, `snapshot` y `outbox` (§4). No-op si
  `indexedDB` no existe.
- `hooks/use-pos-snapshot.ts`: pide la instantánea al montar el POS, cada 5 minutos y al volver la conexión; la
  persiste en IndexedDB. Una petición fallida (sin red) conserva lo último cargado en vez de vaciarlo.
- `app/(dashboard)/pos/page.tsx` usa la instantánea solo mientras `useOnlineStatus()` es `false`: búsqueda y filtro
  por categoría en memoria, en vez de `useInfiniteApiList` contra el servidor. También decide si cobrar sigue
  permitido sin red: `snapshot.data.generated_at` es el último contacto confirmado con el servidor, y si ha pasado
  más de `settings.offline_max_hours` desde entonces (o nunca hubo instantánea), cobrar se deshabilita (§3).
- El logout borra la instantánea (`idbClearSnapshot`), igual que las demás cachés: es un dispositivo compartido y
  los clientes incluyen email/teléfono. La cola de ventas (`outbox`, §4) **no** se borra: ver §7.

Ver [PWA y modo offline](../01-arquitectura/09-pwa-offline.md) y [pos-checkout](../03-modulos/pos-checkout.md).

## 3. Servidor: recibir una venta offline — ✅ Implementada

`create_sale` acepta `p_occurred_at`/`p_expected_total` (ambos opcionales; migración `20260928000001_offline_sales.sql`,
endurecida en `20260930000001_offline_hardening.sql` tras una revisión adversarial — ver §3.1). Sin ellos el
comportamiento es exactamente el de antes (venta online). Con `p_occurred_at`:

- **Ventana:** se recorta a `[now() − settings.offline_max_hours, now()]` (defecto 12 h, solo admin); si se recorta,
  `orders.sync_issues.occurred_at_clamped` guarda lo pedido y lo usado.
- **Precio:** el servidor calcula como siempre (regla dura 1) — `p_expected_total` nunca se usa para escribir, solo
  se compara; si difiere, `orders.sync_issues.price_mismatch` guarda `{expected, actual}` y `payments.amount` es
  siempre el total del servidor.
- **Stock:** con `p_occurred_at` no nulo, la venta **nunca se rechaza por falta de stock** (a diferencia del camino
  online, que sigue rechazando igual que siempre): descuenta lo que haya hasta 0 (el `CHECK ≥ 0` se mantiene) y anota
  `orders.sync_issues.stock_shortfall: [{product_id, missing}]`.
- **Cliente, producto o promoción desactivados mientras la caja estaba offline** ya no rechazan la venta (el dinero
  ya cambió de manos): el cliente se registra como venta de mostrador (`sync_issues.customer_unavailable`) y el
  producto/promoción se precia con su **último valor conocido** (`sync_issues.stale_pricing`) — productos y
  promociones son de baja lógica únicamente (`deleted_at`, nunca `DELETE`), así la fila con su precio siempre existe.
  Solo un `product_id`/`promotion_id` que nunca existió sigue rechazando la venta entera (no hay fila de la que
  partir) — mismo mensaje que en el camino online.
- **Descuento que ya no cabe** (el precio bajó mientras la caja estaba offline, y el descuento aplicado en el
  momento de la venta supera la línea o el total recalculado): se recorta en vez de rechazar la venta
  (`sync_issues.discount_clamped`).
- **`orders.client_ref`** guarda la misma clave que la idempotencia (§1), para que el dispositivo pueda enlazar su
  ticket provisional con la orden ya sincronizada.
- Reportes (`dashboard_summary`, `sales_report`, `top_selling_products`) agrupan/filtran por
  `coalesce(orders.occurred_at, orders.created_at)`, así una venta sincronizada horas o días después sigue cayendo en
  el día real en que ocurrió. El listado `/orders` (`?from&to`) no se tocó: sigue usando `created_at`.
- API: `saleSchema` acepta `occurred_at`/`expected_total`; `lib/server/services/sales.ts` los pasa a la RPC. Desde F3
  el POS los manda de verdad, vía la cola (§4). Ver [pos-checkout](../03-modulos/pos-checkout.md).

Pruebas: `test/integration/offline-sales.test.ts` (ventana, recorte, `price_mismatch`, `stock_shortfall`, cliente
desactivado, producto/promoción inactivos, descuento recortado, idempotencia tras un intento online perdido,
`client_ref`, agrupación de reportes, reembolso con `stock_taken`) y `test/integration/admin.test.ts`
(`offline_max_hours`: validación, solo-admin, defecto).

### 3.1 Endurecimiento tras revisión adversarial (2026-09-24, migración `20260930000001_offline_hardening.sql`)

Una ronda de revisión adversarial (Opus 5.5) sobre F0-F4 encontró tres problemas altos y tres medios, todos
corregidos en esta migración:

1. **Doble cobro si se pierde la respuesta online.** El hash de idempotencia incluía `occurred_at`/`expected_total`:
   una venta que hizo `COMMIT` online pero cuya respuesta se perdió, reencolada offline con la misma
   `Idempotency-Key`, generaba un hash distinto (ahora sí llevaba `occurred_at`) → `BS409` para siempre, y la UI
   invitaba a "volver a registrarla" → venta duplicada. **Corregido:** el hash ya no incluye `occurred_at`/
   `expected_total` (pueden diferir legítimamente entre el intento perdido y su reenvío offline de la misma venta),
   y la comprobación de idempotencia corre **antes** que cualquier validación dependiente de estado (cliente,
   producto), así un reintento de una venta ya cobrada nunca falla por algo que cambió después de cobrarla.
2. **Descartar en el centro de sincronización sin rastro.** Cualquiera en el dispositivo podía descartar, sin dejar
   registro, ventas en cola de otro cajero (incluso mientras se estaban enviando) — una vía de robo de caja
   invisible en una caja compartida. **Corregido:** la lista del centro de sincronización solo muestra las propias
   entradas de un cajero (un gerente ve todas, ya que es quien puede actuar); "Descartar" solo lo puede hacer
   gerente+ (mismo nivel que `refund_order`), nunca sobre una entrada `syncing`, y queda registrado en la auditoría
   **antes** de borrarse localmente (`log_outbox_discard`, §9.2) — exige red a propósito: un descarte que nadie
   pueda revisar después no es seguro permitirlo en silencio sin conexión.
3. **`create_sale` rechazaba varias rutas que F2 prometía nunca rechazar** (cliente desactivado, producto/promoción
   inactivos, descuento que ya no cabe): una entrada quedaba `rejected` para siempre sin salida real. Corregido
   arriba (§3): venta de mostrador, precio de último valor conocido, descuento recortado.
4. **Todo pedido offline queda marcado para revisión** (`sync_issues.offline_sale: true`), incluso sin ninguna otra
   incidencia: `occurred_at` es un parámetro que el cliente controla y es alcanzable desde el `POST /sales` normal
   (no solo desde la cola offline real), así que es la única forma de garantizar que un gerente mire, al menos una
   vez, cada venta que usó la indulgencia offline (nunca rechazar por stock, solo anotar diferencia de precio). Esto
   cambia la promesa original del documento ("una venta offline sin incidencias no necesita revisión") — decisión
   de seguridad deliberada, no un descuido; ver D16 en [decisiones-pendientes](decisiones-pendientes.md).
5. **Un reembolso reponía más stock del que realmente se descontó.** Una venta offline con `stock_shortfall` solo
   descuenta lo que había (`v_taken`), pero `refund_order` reponía la cantidad completa de la línea, fabricando
   stock que nunca existió. Corregido con `order_items.stock_taken` (nuevo, nulo en filas anteriores a esta
   migración — `refund_order` usa `coalesce(stock_taken, quantity)` para ellas, mismo comportamiento que antes).

No corregido en esta pasada, documentado como límite aceptado: el bloqueo de `orders` que provocaría aplicar
`20260928000001_offline_sales.sql` (índice único + `CHECK` en el mismo `ALTER`) contra una base con datos reales —
la tabla no tiene datos de producción todavía (§1 de `AGENTS.md`); el crecimiento sin retención de `idempotency_keys`
(§1); y una ventana estrecha donde un cambio de sesión a mitad de una tanda de sincronización podría atribuir una
venta al usuario que entró después, en vez de a quien la cobró.

## 4. Outbox y motor de sincronización — ✅ Implementada

`lib/offline/outbox.ts` (datos) + `lib/offline/sync.ts` (envío), store `outbox` de `lib/offline/db.ts` (§2):

- Cada entrada (`OutboxEntry`): `client_ref` (la misma clave de idempotencia que genera el POS por intento de
  cobro, ver §1 — también sirve de clave del store), `user_id`, `created_at` del dispositivo (se manda como
  `occurred_at`, §3), `payload` (cliente, método, descuento, ítems — la misma forma que ya validaba `saleSchema`),
  `expected_total`, `provisional_number` (`OFF-XXXXXXXX`, derivado del `client_ref`), `state`, `attempts`,
  `next_attempt_at` (backoff) y `last_error`.
- Estados: `pending → syncing → synced | synced_with_issues | rejected | paused_auth`. `synced`/`synced_with_issues`
  (según si la orden trajo `sync_issues`) y `rejected` son terminales; `pending`/`syncing`/`paused_auth` se
  reintentan. Encolar dos veces con el mismo `client_ref` (un doble clic) sobrescribe la misma fila, nunca duplica.
- `runSync()` corre dentro de `navigator.locks.request('barstock-outbox', …)` cuando el navegador lo soporta
  (Safari/iOS actuales sí); si no, corre igual — la idempotencia protege ante una carrera de todas formas, tal como
  estaba previsto aquí.
- Antes de mandar nada, pide `GET /api/v1/me` (con `redirectOnUnauthorized: false`, §7); sin sesión, no toca la cola.
  Solo se envían las entradas cuyo `user_id` coincide con esa sesión — las de otro usuario quedan en cola para
  cuando ese usuario vuelva a entrar.
- Envío FIFO (por `created_at`, una fila a la vez, dentro de la misma pestaña/lock): `POST /sales` con
  `Idempotency-Key: client_ref` y `occurred_at`/`expected_total` (§3).
  - 2xx sin `sync_issues` → `synced`; con `sync_issues` → `synced_with_issues`.
  - 401 → `paused_auth` y el resto de la cola se deja para el próximo intento (no tiene sentido seguir sin sesión).
  - 4xx de negocio (validación, producto/promoción ya no disponible) → `rejected`, pero se sigue con la siguiente
    entrada.
  - Sin red, 429 o 5xx → sigue `pending` con backoff exponencial (`attempts`, tope 30 min) y se corta el resto de
    la cola para este intento.
- `lib/api/client.ts`: `apiGet`/`apiPost` aceptan `{ redirectOnUnauthorized }` (defecto `true`); la sincronización
  pasa `false` para que un 401 en segundo plano no mande la pestaña entera a `/login`.

## 5. Disparadores de la sincronización — ✅ Implementados

`hooks/use-outbox-sync.ts`, montado una vez en `components/app-shell.tsx` (corre sin importar en qué página esté el
cajero): al montar, en cada evento `online`, cada 60 s (barato cuando la cola está vacía — sale antes de pedir la
sesión), y de forma inmediata cada vez que una escritura local toca la cola (encolar, reintentar, descartar) vía el
evento de `window` `barstock:outbox-changed` (`OUTBOX_CHANGED_EVENT`, `lib/offline/outbox.ts`) — este último es solo
una relectura del contador en IndexedDB, no un intento de sincronizar, así el botón del centro de sincronización
(§9) aparece al instante después de un cobro offline en vez de esperar hasta 60 s. El botón manual "sincronizar
ahora" del centro de sincronización llama a `syncNow()`, que sí intenta un envío real. Background Sync API sigue
descartada: el service worker (`public/sw.js`) está escrito a mano, y duplicar ahí la lógica de sesión/401 no
compensa frente a un intervalo de 60 s en la pestaña abierta.

## 6. Reglas por acción

- **Ventas.** — ✅ Implementada. El precio y el total mostrados offline son **provisionales** (la última foto de
  precio/stock vista de la instantánea, §2). El servidor recalcula al sincronizar (§3): el total del servidor manda
  siempre, una diferencia queda anotada (`sync_issues.price_mismatch`) en vez de bloquear la venta, y la falta de
  stock **nunca** la rechaza (se registra el faltante, `sync_issues.stock_shortfall` — decisión tomada 2026-09-22,
  ver la cabecera del documento). Solo un producto/promoción inactivo o borrado la rechaza de verdad (`rejected` en
  la cola, §4). El número de orden (`order_number`, una secuencia) se asigna **al sincronizar**, no al vender: antes
  de eso el POS solo conoce el `provisional_number` (`OFF-XXXXXXXX`) — el ticket impreso lo muestra marcado
  "PROVISIONAL — pending sync" (`lib/receipt-preview.ts` arma la orden provisional con la misma matemática que la
  vista previa del carrito; `components/orders/receipt-ticket.tsx` pinta el sello) y la pantalla de detalle de la
  orden (`app/(dashboard)/orders/[id]/page.tsx`) muestra `sync_issues` con la acción "marcar revisada" para
  gerente+ (§9).
- **Cuentas.** Fuera de alcance v1 (decisión 2026-09-22, ver la cabecera): siguen deshabilitadas sin red
  (`OfflineDisabledButton`). Si se necesitan más adelante: solo se podría operar sobre cuentas ya vistas en caché, y
  dos dispositivos añadiendo a la misma cuenta offline es un conflicto real sin resolver (último gana, o unir
  líneas).
- **Ajustes de inventario.** Fuera de alcance v1, igual que cuentas. Seguirían deshabilitados sin red; son
  **deltas** (`+5`, `-2`), lo que los haría el caso más simple de encolar si se añaden después.

## 7. Sesión — ✅ Implementada

- Si la sesión expira mientras el dispositivo está sin red, la cola se conserva en IndexedDB
  (`idbClearSnapshot`, llamada al cerrar sesión, deliberadamente **no** toca el store `outbox`) y solo se reintenta
  sincronizar cuando vuelve a haber sesión **del mismo usuario** (`entry.user_id` contra `GET /me`, §4).
- Un `401` durante la sincronización **pausa** esa entrada (`paused_auth`) sin navegar: `lib/api/client.ts` acepta
  `{ redirectOnUnauthorized: false }` y el motor de sincronización siempre lo pasa, así un 401 en segundo plano
  nunca dispara `handleUnauthorized` (que mandaría la pestaña entera a `/login`, perdiendo el carrito en curso).
- Cerrar sesión con entradas sin sincronizar muestra un `ConfirmDialog` (`components/shell/account-menu.tsx`)
  explicando que se conservan y se envían solas al volver a entrar; no bloquea el cierre de sesión.

## 8. Auditoría

Las acciones sincronizadas se registran igual que cualquier otra escritura (ver [auditoría](../03-modulos/auditoria.md)):
el trigger genérico usa `auth.uid()` de la sesión que sincroniza, y `orders.occurred_at`/`source`/`sync_issues`
llegan a `changes` sin trabajo aparte, ya que son columnas normales de `orders`.

## 9. Centro de sincronización en la UI — ✅ Implementado

- `components/offline/sync-center.tsx` (`SyncCenter`), montado en `components/shell/top-bar.tsx` junto al badge de
  conexión: un botón con el conteo (`useOutboxSync().pendingCount`, ICU plural) visible solo mientras hay alguna
  entrada en un estado que necesita atención (`pending`/`syncing`/`paused_auth`/`rejected`; `synced`/
  `synced_with_issues` no cuentan). Se abre en un `Sheet` con la lista completa de la cola
  (`listOutboxEntries`, `lib/offline/outbox.ts`): número provisional, estado, total esperado, y el último error si
  lo hay.
- Acciones por entrada: "Retry" (`retryOutboxEntry`, solo para `rejected`/`paused_auth` — vuelve a `pending` sin
  arrastrar el backoff) y "Discard" (§9.2). Ambas disparan el evento `barstock:outbox-changed` (§5) para que el
  contador se actualice al instante.
- **Visibilidad por rol (§3.1, hallazgo 2):** un cajero solo ve las entradas de la cola que él mismo encoló
  (`entry.user_id === user.id`); un gerente+ ve todas las del dispositivo, ya que es el único que puede actuar sobre
  ellas ("Discard").
- El ticket impreso muestra "PROVISIONAL — pending sync" mientras la venta no tiene `order_number` real
  (`ReceiptTicketProps.provisional`, `components/orders/receipt-ticket.tsx`); el toast de checkout offline incluye
  un botón "Print ticket" que imprime esa vista provisional (`lib/receipt-preview.ts` construye la orden a partir
  del carrito, sin tocar el servidor).
- Filtro "con incidencias de sincronización" en `/orders` (`?needs_review=true` → `sync_issues is not null and
  reviewed_at is null`, solo visible para gerente+) y la acción "Mark reviewed" en el detalle de la orden
  (`app/(dashboard)/orders/[id]/page.tsx`), que llama a la RPC `mark_order_reviewed` (§9.1) vía
  `PATCH /api/v1/orders/[id]/review` — necesaria porque los privilegios de tabla de `orders` están revocados y toda
  escritura pasa por una RPC `SECURITY DEFINER` (regla dura 1).

### 9.1 RPC `mark_order_reviewed`

Migración `20260929000001_order_review.sql`. Gerente+; recibe `p_order_id`, bloquea la fila (`for update`), lanza
`P0002` si no existe la orden o un error genérico si `sync_issues` es `null` (no tiene sentido revisar una orden sin
incidencias), y si no, actualiza `reviewed_by`/`reviewed_at`. Es **intencionalmente idempotente** — volver a marcar
una orden ya revisada solo refresca quién y cuándo, igual que `refund_order` — no un descuido.

### 9.2 Descartar una entrada de la cola: gerente+, con auditoría (§3.1, hallazgo 2)

"Discard" (`components/offline/sync-center.tsx`, `DiscardDialog`) solo aparece para gerente+ y nunca sobre una
entrada `syncing` (evita competir con un envío en curso). Requiere un motivo de al menos 3 caracteres y, antes de
borrar nada localmente, llama a `PATCH /api/v1/outbox/discard-log` → RPC `log_outbox_discard`
(`20260930000001_offline_hardening.sql`; gerente+, mismo nivel que `refund_order`), que escribe una fila en
`audit_log` (`action = 'discard'`, `entity = 'outbox'`, `entity_id` = el número provisional — no hay orden real con
la que asociarlo, la venta nunca llegó al servidor) con el total esperado, el método de pago y el motivo. Si esa
llamada falla (sin red, por ejemplo), el descarte se cancela y la entrada sigue en la cola — un descarte sin rastro
en ningún lado no es seguro permitirlo. Recién entonces `discardOutboxEntry` borra la entrada de IndexedDB.

## 10. Decisiones de negocio

1. ¿Se permiten ventas offline en absoluto, o el POS debe negarse a cobrar sin red? **Implementado que sí** (F3);
   la decisión formal con el negocio, más allá de la técnica, sigue sin registrarse aquí.
2. Si se permiten, ¿solo en efectivo (sin verificación de tarjeta posible offline)? No se restringió: los tres
   métodos de pago (`cash`/`card`/`ewallet`) se pueden encolar — el datáfono es externo y no lo valida la app de
   todas formas (ver H3 en [decisiones-pendientes](decisiones-pendientes.md)).
3. ~~¿Cuánto tiempo máximo puede una caja operar sin conexión antes de bloquearse?~~ **Decidido (2026-09-22):**
   configurable, `settings.offline_max_hours`, 12 h por defecto (§3).
4. ~~¿Qué pasa con una venta rechazada al sincronizar (stock insuficiente) si el producto ya se entregó al cliente?~~
   **Decidido (2026-09-22):** no se rechaza; se registra con el faltante anotado para que un gerente la revise (§3,
   §6, §9 — la pantalla de revisión ya está construida).

## 11. Pruebas

- Concurrencia e idempotencia de `create_sale`: la misma clave enviada dos veces **a la vez** produce un solo
  efecto — `test/integration/sales.test.ts` (en paralelo, con payload distinto, tras un fallo, sin clave).
- Ventas offline (ventana, recorte, `price_mismatch`, `stock_shortfall`, cliente desactivado, producto/promoción
  inactivos, descuento recortado, idempotencia tras un intento online perdido, `client_ref`, agrupación de reportes
  por `occurred_at`, reembolso con `stock_taken`): `test/integration/offline-sales.test.ts`.
- `offline_max_hours` (validación, solo-admin, defecto): `test/integration/admin.test.ts`.
- Outbox (estados, filtrado FIFO, conteo, `client_ref` idempotente): `lib/offline/outbox.test.ts`.
- Motor de sincronización (éxito, `sync_issues` → `synced_with_issues`, 401 → `paused_auth` y corta la cola, 4xx →
  `rejected` y sigue, red/5xx → backoff y corta la cola, usuario distinto se salta, backoff no vencido se salta):
  `lib/offline/sync.test.ts`.
- Disparadores del hook (montaje, evento `online`, un fallo conserva el contador anterior):
  `test/components/use-outbox-sync.test.tsx`.
- Checkout offline en el POS (cola en vez de red, botón bloqueado si expiró la ventana): `test/components/pos.test.tsx`.
- Ticket provisional (`buildProvisionalOrder`: línea simple, expansión de promoción, línea sin resolver, cliente/
  cajero, un solo pago): `lib/receipt-preview.test.ts`; sello "PROVISIONAL" en el ticket: `test/components/receipt-ticket.test.tsx`.
- Centro de sincronización (oculto sin nada pendiente, contador y lista, retry, visibilidad por rol en un
  dispositivo compartido, discard gerente+ con auditoría obligatoria y bloqueado si falla el registro):
  `test/components/sync-center.test.tsx`.
- Revisión de gerente (`mark_order_reviewed`: solo gerente+, error sin `sync_issues`, idempotente, filtro
  `needs_review`): `test/integration/offline-sales.test.ts`.
- E2E de ida y vuelta offline → online (`e2e/offline.e2e.ts`): cobrar sin red, comprobar que el stock no se mueve
  todavía, que el centro de sincronización aparece al instante con la venta en cola, que el ticket impreso dice
  "PROVISIONAL", recuperar la red y comprobar que sincroniza sola (el stock baja y el botón desaparece).
