# Módulo: POS y cobro

> Actualizado con idempotencia (F0), instantánea offline (F1), recepción de ventas offline (F2) y cobro sin red (F3) · `app/(dashboard)/pos/page.tsx` + `components/pos/*` · API `POST /sales`, `GET /pos/snapshot` · RPC `create_sale` · Servicio `services/sales.ts`, `services/pos.ts` · Cliente `lib/offline/{outbox,sync}.ts` · Confianza: **[Verificado]** (`sales.test.ts` / `offline-sales.test.ts` / `rpc.test.ts` / `create-sale-promotions.test.ts` / `pos-snapshot.test.ts`, `pos.test.tsx`, `use-pos-snapshot.test.tsx`, `outbox.test.ts`, `sync.test.ts`, `use-outbox-sync.test.tsx`, `promotion-allocate.test.ts`, `e2e/offline.e2e.ts`).

> Sustituye al análisis anterior, donde el cobro eran 5 llamadas sueltas desde el navegador, sin transacción, con totales calculados en el cliente y un descuento de stock que probablemente no funcionaba
> ([C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md), ahora **Verificado**). El estado previo queda en el historial de git (commit `54962b9`).

## Pantalla
La página orquesta estado, queries y `handleCheckout` sobre componentes en `components/pos/`:
- **`promotions-strip.tsx` + `promotion-card.tsx` + `promotions-browser-dialog.tsx`:** franja horizontal con scroll; «Ver todas» abre un modal con la misma confirmación de cantidad (−/+/Confirmar) que los productos.
- **`product-grid.tsx` + `product-card.tsx`:** rejilla compacta con scroll infinito. Un toque abre el stepper; confirmar añade N unidades.
- **`top-products.tsx`:** franja "Más vendidos (30 días)". Cuenta **componentes** de combo como unidades del SKU (no el nombre del paquete).
- **`cart-bubble.tsx` + `cart-sheet.tsx`:** burbuja flotante + Sheet (Carrito / Cuentas). Las líneas promo se muestran agrupadas con sublíneas de componentes.

## Flujo (venta directa)
1. El cajero busca o filtra y pulsa un producto **o una promo**: estado pendiente en la página (una tarjeta a la vez); confirma cantidad.
2. El carrito guarda líneas discriminadas (`kind: 'product' | 'promotion'`); `GET /products?ids=…` y `GET /promotions?ids=…` alimentan la vista previa (reparto de precio vía `allocatePackagePrice`, espejo de la RPC).
3. *Checkout* → método de pago → `POST /api/v1/sales` con ítems `{ product_id, quantity, discount? }` **o** `{ promotion_id, quantity }`.
4. `create_sale` expande paquetes, fija `unit_price` asignado (no el de catálogo), baja stock por componente y devuelve la orden. El toast muestra ese total.
5. Si falla, el carrito se conserva y se refresca el stock.

**Idempotencia del cobro:** la página genera un UUID por intento de cobro (al abrir el diálogo de pago) y lo manda en la
cabecera `Idempotency-Key`; se conserva mientras el carrito no cambie, así reintentar tras un error de red (o pulsar
"Cobrar" dos veces) reutiliza la misma clave. `create_sale` la guarda en `idempotency_keys` y, si la misma clave
llega dos veces con el mismo `user_id` y el mismo payload, devuelve la orden ya creada en vez de cobrar otra vez; con
un payload distinto responde 409. Corrige el doble cobro por respuesta perdida (F0 en
[offline y sincronización](../06-roadmap/offline-y-sincronizacion.md), que documenta el resto del diseño offline —
F0 a F3 ya implementadas, F4 pendiente).

**Navegar sin red:** mientras `useOnlineStatus()` es `false`, la búsqueda y el filtro por categoría del catálogo (y
las promociones, clientes y líneas del carrito) se leen en memoria de una instantánea (`GET /api/v1/pos/snapshot`,
`hooks/use-pos-snapshot.ts`, persistida en IndexedDB) en vez de pedirlos al servidor — F1 en
[offline y sincronización](../06-roadmap/offline-y-sincronizacion.md).

**Cobrar sin red (F3):** `handleCheckout` ya no depende de estar en línea. Con red, cobra como siempre
(`salesApi.create`). Sin red, y mientras la instantánea (arriba) siga dentro de la ventana
`settings.offline_max_hours` (si no, el botón se deshabilita con un aviso — "demasiado tiempo sin conexión"),
encola la venta en IndexedDB (`lib/offline/outbox.ts`, `enqueueSale`) con el mismo `client_ref` que ya generaba
para la cabecera `Idempotency-Key`, el total previsto y el payload de la venta; el toast muestra el número
provisional (`OFF-XXXXXXXX`) y el carrito se vacía igual que en una venta online. Un motor de sincronización
(`lib/offline/sync.ts`, disparado por `hooks/use-outbox-sync.ts` — montado una vez en `AppShell`, corre al volver
la conexión y cada 60 s) manda esa cola a `POST /sales` con `occurred_at`/`expected_total`/`Idempotency-Key` en
cuanto hay red y sesión: ahí es donde `create_sale` calcula precio y stock de verdad (F2, más abajo). El servidor
recalcula, nunca se pierde una venta por falta de stock (se anota el faltante) y una orden repetida por
reintento/doble pestaña se resuelve por la misma idempotencia. Cerrar sesión con ventas sin sincronizar las
conserva y avisa (no las borra). Detalle completo, incluidos los estados de la cola y las pruebas, en F3 de
[offline y sincronización](../06-roadmap/offline-y-sincronizacion.md).

**Lo que el servidor hace con una venta offline (F2).** `saleSchema` acepta `occurred_at` (hora del dispositivo) y
`expected_total` (el total provisional que mostró el POS) opcionales; `create_sale` los usa si llegan: recalcula
precio/impuestos como siempre (nunca confía en `expected_total`, solo anota la diferencia), ajusta `occurred_at` a
la ventana `settings.offline_max_hours` (recortándolo si se pasa) y, si `occurred_at` no es nulo, **nunca rechaza
por falta de stock** — descuenta lo que haya (hasta 0) y anota el faltante. Cualquier diferencia queda en
`orders.sync_issues` (`occurred_at_clamped`/`price_mismatch`/`stock_shortfall`) para que un gerente la revise (F4,
sin pantalla todavía — hoy la cola solo muestra un toast, sin centro de sincronización ni ticket marcado
"PROVISIONAL").

**Cuentas abiertas:** el carrito (productos y/o promociones) se puede enviar a una cuenta vía `tab_add_items` (misma expansión de paquetes que `create_sale`). Ver [cuentas-abiertas](cuentas-abiertas.md) y [promociones](promociones.md).

## Lo que el cliente envía y lo que decide la BD
```json
POST /api/v1/sales
{ "customer_id": null, "payment_method": "card", "discount": 0,
  "items": [
    { "product_id": "…", "quantity": 2, "discount": 0 },
    { "promotion_id": "…", "quantity": 1 }
  ] }
```
**Solo ids, cantidades y descuentos de línea de producto.** Precio/tasa/totales salen de la BD; un `unit_price` enviado en una promo se ignora.

## Reglas de cálculo (D3 + D-promos)
- Producto suelto: igual que antes (`selling_price` + `tax_rate` del catálogo).
- Promo: base total = `package_price × paquetes`, repartida proporcionalmente a `selling_price × qty` del componente; última línea absorbe el redondeo a `money_scale`. Impuesto **por producto** sobre la base asignada.
- `total = Σ base + Σ impuesto − descuento global`.

## Validaciones y rechazos
Carrito vacío, > 100 entradas o > 200 líneas tras expansión, cantidad ≤ 0, promo inactiva/borrada o con componente inactivo,
stock insuficiente en cualquier componente (atómico), etc. **Excepción:** una venta offline (`occurred_at` no nulo)
nunca se rechaza por falta de stock — ver F2 arriba.

## Pantalla: comportamiento
- Carrito persistido (`pos-cart` v3: líneas discriminadas; versiones anteriores se descartan).
- Tope de `+` = stock (o paquetes disponibles) − ya en carrito.
- Ticket e detalle de orden **agrupan** por `promotion_id` en UI; la BD sigue descompuesta.

Relacionados: [Promociones](promociones.md), [Órdenes y reembolsos](ordenes-y-reembolsos.md), [Cuentas abiertas](cuentas-abiertas.md), [decisiones pendientes](../06-roadmap/decisiones-pendientes.md).
