# Plan: cola offline y sincronización (no implementado)

> Estado: la cola de escrituras sigue **solo documento**, sin código; F0 (idempotencia de `create_sale`) y F1
> (instantánea del catálogo del POS) son la excepción, **implementadas**. Complementa
> [PWA y modo offline](../01-arquitectura/09-pwa-offline.md), que sí está implementado (lectura offline, avisos de
> conexión, instalación, instantánea del POS). Referencia: D16 en [decisiones-pendientes](decisiones-pendientes.md).

## Por qué todavía no hay cola de escrituras

Encolar ventas, pagos de cuentas y ajustes de inventario sin red es un cambio grande: toca la BD (idempotencia), el
cliente (outbox persistente), la sesión (qué pasa si expira sin red) y trae decisiones de negocio sin resolver (¿se
permiten ventas offline? ¿solo en efectivo?). Se documenta aquí el diseño para no perder el análisis, pero no se
implementa hasta que el negocio responda las preguntas de la sección 8.

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
- `lib/offline/db.ts`: envoltorio mínimo de IndexedDB con dos stores, `snapshot` (en uso) y `outbox` (reservado para
  cuando exista la cola de escrituras). No-op si `indexedDB` no existe.
- `hooks/use-pos-snapshot.ts`: pide la instantánea al montar el POS, cada 5 minutos y al volver la conexión; la
  persiste en IndexedDB. Una petición fallida (sin red) conserva lo último cargado en vez de vaciarlo.
- `app/(dashboard)/pos/page.tsx` usa la instantánea solo mientras `useOnlineStatus()` es `false`: búsqueda y filtro
  por categoría en memoria, en vez de `useInfiniteApiList` contra el servidor. Cobrar sigue deshabilitado sin red
  (`OfflineDisabledButton`): esto solo respalda navegar y armar el carrito, nunca el cálculo final de precio/stock.
- El logout borra la instantánea (`idbClearAll`), igual que las demás cachés: es un dispositivo compartido y los
  clientes incluyen email/teléfono.

Ver [PWA y modo offline](../01-arquitectura/09-pwa-offline.md) y [pos-checkout](../03-modulos/pos-checkout.md).

## 3. Outbox en IndexedDB

- Cada entrada: acción, payload, `user_id`, hora del cliente (`client_occurred_at`), `client_ref` (generado en el
  cliente, ver §1).
- Estados: `pendiente → sincronizando → sincronizada | con diferencias | rechazada`.
- El envío es FIFO **por dispositivo** (dos cajas offline a la vez no se coordinan entre sí; cada una sincroniza su
  propia cola cuando recupera red).
- El store `outbox` de `lib/offline/db.ts` (§2) ya existe en el esquema de IndexedDB; falta la lógica que lo llena y
  la vacía.

## 4. Disparadores de la sincronización

El evento `online` (`hooks/use-online-status.ts` ya existe y puede disparar esto), el arranque de la app, un botón
manual en el centro de sincronización (§8), y Background Sync API donde el navegador lo soporte (degradar
silenciosamente donde no: Safari/iOS no lo soporta hoy).

## 5. Reglas por acción

- **Ventas.** El precio y el total mostrados offline son **provisionales** (la última foto de precio/stock vista). El
  servidor recalcula al sincronizar; si el total cambia o la venta se rechaza (stock insuficiente, precio cambiado,
  promoción ya inactiva), el usuario recibe un aviso con acción (aceptar el nuevo total, o descartar). El número de
  orden (`order_number`, hoy una secuencia) se asigna **al sincronizar**, no al vender: el ticket offline es
  provisional y lo dice explícitamente.
- **Cuentas.** Solo se puede operar sobre cuentas ya vistas en caché. Dos dispositivos añadiendo a la misma cuenta
  offline es un conflicto real: la resolución (último gana, o unir líneas) es una decisión de negocio pendiente. El
  stock se descuenta en el servidor al sincronizar, nunca en el cliente.
- **Ajustes de inventario.** Son **deltas** (`+5`, `-2`), no valores absolutos: conmutan sin conflicto entre sí y son
  el caso más simple de la cola.

## 6. Sesión

- Si la sesión expira mientras el dispositivo está sin red, la cola se conserva en IndexedDB y solo se reintenta
  sincronizar cuando vuelve a haber sesión **del mismo usuario** (comparar `user_id` de la entrada contra la sesión
  activa antes de reenviar).
- Un `401` durante la sincronización debe **pausar** la cola, no navegar a `/login`. Hoy `handleUnauthorized`
  (`lib/api/client.ts`) hace `window.location.assign('/login?...')` en cualquier 401 fuera de `auth/*`: la sincronización
  en segundo plano necesita una ruta que no dispare esa redirección (por ejemplo, un cliente de sincronización
  separado que solo marque la cola como "pausada" y muestre un aviso, en vez de navegar).

## 7. Auditoría

Las acciones sincronizadas se registran igual que cualquier otra escritura (ver [auditoría](../03-modulos/auditoria.md)),
con `changes`/metadata incluyendo `client_occurred_at` para poder reconstruir cuándo ocurrió realmente la acción en el
dispositivo, no solo cuándo llegó al servidor.

## 8. Centro de sincronización en la UI

- Un contador de pendientes visible en el header (junto al badge de conexión, `components/connection-status.tsx`).
- Una lista de entradas **rechazadas** con opción de reintentar o descartar cada una.

## 9. Decisiones de negocio pendientes (bloquean la implementación)

1. ¿Se permiten ventas offline en absoluto, o el POS debe negarse a cobrar sin red?
2. Si se permiten, ¿solo en efectivo (sin verificación de tarjeta posible offline)?
3. ¿Cuánto tiempo máximo puede una caja operar sin conexión antes de bloquearse?
4. ¿Qué pasa con una venta rechazada al sincronizar (stock insuficiente) si el producto **ya se entregó** al cliente?

## 10. Pruebas necesarias cuando esto se implemente

- Concurrencia e idempotencia de la cola: la misma clave enviada dos veces **a la vez** (dos pestañas, o un reintento
  automático que se solapa con uno manual) debe producir un solo efecto. Para `create_sale` ya cubierto en
  `test/integration/sales.test.ts` (clave repetida en paralelo, con payload distinto, tras un fallo, sin clave).
- E2E de ida y vuelta offline → online: encolar una venta sin red, recuperar la red, comprobar que se sincroniza una
  sola vez y que el número de orden final es el que asignó el servidor.
