# Módulo: POS y cobro

> Actualizado tras promociones (paquetes) · `app/(dashboard)/pos/page.tsx` + `components/pos/*` · API `POST /sales` · RPC `create_sale` · Servicio `services/sales.ts` · Confianza: **[Verificado]** (`sales` / `rpc` / `create-sale-promotions`, `pos.test.tsx`, `promotion-allocate.test.ts`).

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
[offline y sincronización](../06-roadmap/offline-y-sincronizacion.md), que además documenta el resto del diseño
offline, todavía sin implementar).

**Navegar sin red:** mientras `useOnlineStatus()` es `false`, la búsqueda y el filtro por categoría del catálogo (y
las promociones, clientes y líneas del carrito) se leen en memoria de una instantánea (`GET /api/v1/pos/snapshot`,
`hooks/use-pos-snapshot.ts`, persistida en IndexedDB) en vez de pedirlos al servidor — F1 en
[offline y sincronización](../06-roadmap/offline-y-sincronizacion.md). Cobrar sigue deshabilitado sin red
(`OfflineDisabledButton`): la instantánea solo respalda navegar y armar el carrito, nunca el cobro en sí.

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
Carrito vacío, > 100 entradas o > 200 líneas tras expansión, cantidad ≤ 0, promo inactiva/borrada o con componente inactivo, stock insuficiente en cualquier componente (atómico), etc.

## Pantalla: comportamiento
- Carrito persistido (`pos-cart` v3: líneas discriminadas; versiones anteriores se descartan).
- Tope de `+` = stock (o paquetes disponibles) − ya en carrito.
- Ticket e detalle de orden **agrupan** por `promotion_id` en UI; la BD sigue descompuesta.

Relacionados: [Promociones](promociones.md), [Órdenes y reembolsos](ordenes-y-reembolsos.md), [Cuentas abiertas](cuentas-abiertas.md), [decisiones pendientes](../06-roadmap/decisiones-pendientes.md).
