# Módulo: Promociones (paquetes)

> Actualizado 2026-09-22 · migraciones `20260924000001` (tablas/RLS) + `20260924000002` (`create_sale` expansión) + `20260925000001` (`tab_add_items` promos) · API `promotions`, `promotions/[id]` · UI `/promotions` (gerente+) · venta en POS y cuentas · Confianza: **[Verificado]** en local (RPC + allocation unitario).

- **Qué es:** paquete multi-producto a **precio fijo** (`package_price`). **Sin stock propio:** disponibilidad = `floor(min(stock_i / qty_i))` sobre componentes activos con inventario (`promotion.available` en la API).
- **Dónde se ve el inventario derivado:**
  - `/promotions`: columna **Paquetes disponibles**, stock por componente en la receta, badge **Limita** en el cuello de botella; el diálogo de alta/edición muestra una **estimación en vivo**.
  - POS: franja horizontal con scroll + modal «Ver todas»; badge `{N} paquetes` + tooltip con receta y stock por componente.
  - `/inventory`: sección solo lectura **Paquetes vendibles** (tabla con altura máxima y scroll; mismas cifras; el ajuste de unidades sigue en cada producto).
- **Quién:** cajero+ **lee** y vende en POS; **gerente/admin** crea, edita y borra (lógico). La página y el nav de promociones exigen gerente+.
- **Formulario:** nombre*, precio de paquete*, líneas producto+cantidad (≥ 1, ≤ 50, sin producto repetido). Al editar: `is_active`.
- **Borrado:** soft-delete (`deleted_at` + `is_active = false`). **No** hay DELETE físico (FK histórica en `order_items.promotion_id`).
- **Venta (híbrido):** el carrito/ticket agrupan el paquete; `create_sale` **expande** a `order_items` por producto con `unit_price` **asignado** (reparto proporcional a `selling_price × qty` del catálogo; última línea absorbe el redondeo; **no** se usa el precio de lista como `unit_price`). Impuesto por producto; stock por componente; `promotion_id` en cada línea expandida. Helper compartido: `lib/promotion-allocate.ts` (preview del carrito = RPC).
- **Payload:** `{ product_id, quantity, discount? }` **o** `{ promotion_id, quantity }` (nunca ambos). Tras expansión ≤ 200 líneas.
- **Cuentas abiertas:** `tab_add_items` acepta el mismo payload product|promo; expande con precio asignado; `tab_items.promotion_id` + `discount` mantienen el combo separado del SKU a lista. Se pueden **acumular** paquetes en la misma cuenta (upsert suma qty/discount; foto de precio en el primer añadido). En el detalle de la cuenta el paquete se ve como **un bloque** (un total; sin precios unitarios ni quitar por componente en la UI).
- **Dinero (ingreso vs lista vs costo):**
  - **Cobrado:** `order_items.unit_price` asignado; `orders.subtotal`/`total` y reportes de ingreso usan eso (p. ej. combo 17 000, no 20 000 de lista).
  - **Lista:** `products.selling_price` solo pondera el reparto y alimenta el **markdown de promo** en reportes (`promo_markdown` = lista × qty − base asignada).
  - **Costo:** `products.cost_price` no cambia con el combo; la utilidad bruta en `/reports` es base cobrada − costo *actual* ([D-margin](../06-roadmap/decisiones-pendientes.md)).
- **Top 5 / reportes por SKU:** cuentan **componentes** a precio asignado; `/reports` también tiene **top promociones** (paquetes).
- **Reembolso:** sin cambios de lógica (`refund_order` reestoca por líneas); la UI agrupa por `promotion_id`.
- **POS UI:** franja horizontal con scroll + «Ver todas» (modal); inventario «Paquetes vendibles» con scroll interno.
- **Fuera de v1:** escalas por cantidad, cupones, vigencia por fechas, variantes en combo, reembolso parcial por promo, snapshot de costo/lista en la línea, quitar paquete atómico en tabs.

Relacionados: [Productos](productos.md), [POS](pos-checkout.md), [Reportes](reportes.md), [D-promos](../06-roadmap/decisiones-pendientes.md), [esquema](../02-base-de-datos/01-esquema-tablas.md).
