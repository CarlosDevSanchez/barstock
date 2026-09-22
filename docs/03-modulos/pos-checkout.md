# Módulo: POS y cobro

> Actualizado tras la etapa 1 · `app/(dashboard)/pos/page.tsx` · API `POST /sales` · RPC `create_sale` · Servicio `services/sales.ts` · Confianza: **[Verificado]** (`sales.test.ts`, `rpc.test.ts` con concurrencia, `pos.test.tsx`, e2e `sale-and-refund`).

> Sustituye al análisis anterior, donde el cobro eran 5 llamadas sueltas desde el navegador, sin transacción, con totales calculados en el cliente y un descuento de stock que probablemente no funcionaba
> ([C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md), ahora **Verificado**). El estado previo queda en el historial de git (commit `54962b9`).

## Flujo
1. El cajero busca (nombre, SKU o código de barras) o filtra por categoría y pulsa un producto: se añade **solo el id** al carrito. Los sin stock (o sin fila de inventario) no se pueden añadir.
2. El POS pide `GET /products?ids=…` con los productos del carrito para tener su **precio, tasa y stock actuales** y muestra una **vista previa** (subtotal, impuesto, descuento, total).
3. *Checkout* → método de pago (efectivo, tarjeta, e-wallet) → *Complete Order* → `POST /api/v1/sales`.
4. El servidor ejecuta `create_sale` en **una transacción** y devuelve la orden con **los totales que calculó la base de datos**. El `toast` muestra ese total con un enlace a la orden; el carrito se vacía.
5. Si falla (p. ej. stock insuficiente) el carrito **se conserva**, se recargan catálogo y stock y el `toast` explica el motivo.

## Lo que el cliente envía y lo que decide la BD
```json
POST /api/v1/sales
{ "customer_id": null, "payment_method": "card", "discount": 0,
  "items": [{ "product_id": "…", "quantity": 2, "discount": 0 }] }
```
**Solo ids, cantidades y descuentos.** Precio, tasa de impuesto y totales **se leen de la BD**; cualquier `unit_price`/`total` que se envíe se ignora (probado). La variante, si se indica, debe pertenecer al producto.

## Reglas de cálculo (D3, supuesto aplicado, **sin validar** con el negocio)
- Impuesto **por producto** (`products.tax_rate`, fracción); precios **sin** impuesto.
- Por línea: `base = precio × cantidad − descuento de línea`; `impuesto = round(base × tasa, 2)` (**redondeo por línea**, mitad hacia arriba).
- `total = Σ base + Σ impuesto − descuento global` (el descuento global se aplica **después** del impuesto).
- Ejemplo verificado: 2 × 29,99 + 1 × 12,99 al 10 % → subtotal 72,97; impuesto 6,00 + 1,30 = 7,30; **total 80,27**.
- Se crea la orden `completed`, sus líneas, **un pago por el total** y un movimiento `sale` por línea. `orders_total_matches` y `order_items_total_matches` vigilan la aritmética.

## Validaciones y rechazos
Carrito vacío o > 200 líneas, cantidad ≤ 0, descuentos negativos o con más de 2 decimales, cliente inactivo o inexistente, producto inactivo/borrado/inexistente, descuento mayor que la línea o el total,
**stock insuficiente** (mensaje: `Insufficient stock for "<producto>"`). Un error en cualquier línea **no deja nada escrito** (ni orden ni movimientos).

## Concurrencia (verificado)
El `UPDATE inventory … WHERE quantity >= n` bloquea la fila: dos ventas de la última unidad → **una** pasa y la otra recibe "Insufficient stock"; 25 ventas de 1 unidad con 7 en stock venden **exactamente 7**;
las líneas se procesan **ordenadas** por producto, por lo que ventas cruzadas no producen deadlocks. Cada protección se probó **rompiéndola a propósito**.

## Pantalla: comportamiento
- Carrito persistido en `localStorage` (**solo ids y cantidades**, ver [estado](../01-arquitectura/04-estado-cliente.md)); se vacía al cerrar sesión.
- "+" deshabilitado al llegar al stock. Si al reabrir el carrito un producto se agotó, se borró o se desactivó, la línea lo dice ("Only 0 in stock" / "No longer available") y el **checkout queda bloqueado** hasta quitarla.
- El descuento global es un campo numérico (≥ 0). Un cliente opcional (los activos; "Walk-in Customer" por defecto).
- Catálogo: hasta 100 productos por búsqueda (avisa "Showing 100 of N"); accesible con teclado.

## Límites conocidos
- **Sin recibo:** el toast enlaza a la orden; no se imprime nada desde el POS (D15).
- Un solo pago por el total: sin pagos mixtos, vuelto ni propinas (D5). Sin descuento por línea en la UI (la API lo admite) y sin topes ni motivo de descuento (D6).
- Sin variantes en el POS (D10), sin escáner dedicado (el lector actúa como teclado sobre el buscador), sin ventas en espera ni modo offline (D16).
- La vista previa puede diferir del total final si el precio cambia entre tanto; el total final manda.

Relacionados: [Órdenes y reembolsos](ordenes-y-reembolsos.md), [Inventario](inventario.md), [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md), [decisiones pendientes](../06-roadmap/decisiones-pendientes.md).
