# Módulo: Órdenes y reembolsos

> Actualizado con las columnas offline (F2) y la revisión de gerente para `sync_issues` (F4) · `app/(dashboard)/orders/page.tsx`, `orders/[id]/page.tsx`, `components/orders/receipt-ticket.tsx` · API `orders`, `orders/[id]`, `orders/[id]/refund`, `orders/[id]/review` · RPC `refund_order`, `create_sale`, `mark_order_reviewed` · Confianza: **[Verificado]** (`sales.test.ts`, `offline-sales.test.ts`, `rpc.test.ts`, `rls.test.ts`, `receipt.test.ts`, `receipt-ticket.test.tsx`, e2e).

## Quién ve qué
| Rol | Lista y detalle | Reembolsar |
|---|---|---|
| cajero | **Solo las órdenes que creó** (RLS por `created_by`); las ajenas dan `404` | ❌ |
| gerente, admin | Todas | ✅ |

Las líneas (`order_items`) y los pagos (`payments`) heredan la visibilidad de su orden.

## Lista
Paginada (25), ordenada por fecha; búsqueda por **número de orden** (`ORD-YYMMDD-NNNNNN`) y filtro por estado (`completed`, `refunded`). Gerente+ ve además un filtro "Needs review" (`?needs_review=true`, ver §Revisión más abajo) y una `Badge` de alerta en las filas que lo necesitan. Al pulsar una fila se abre el detalle.

## Detalle
Datos de la orden, quién la creó (nombre o email), cliente (o "Walk-in"), método y monto del pago, líneas con precio, descuento, impuesto y total, y el resumen (subtotal, impuesto, descuento, total).
Una orden reembolsada muestra fecha y **motivo** del reembolso.
Una orden con `sync_issues` muestra una tarjeta con el detalle (§Revisión).

## Ticket de 80 mm (Fase 5, `components/orders/receipt-ticket.tsx`)
"Print" (`window.print()`) imprime el ticket a través de `PrintableReceipt` (`components/orders/printable-receipt.tsx`): un portal `#print-root` en `document.body`. En `@media print`, `app/globals.css` oculta el resto de los hijos de `body`. El ticket
térmico de 80 mm: logo de la tienda si hay uno subido (`store_logo_url`, ≤ 48 mm de ancho), nombre y NIT de la tienda, dirección y teléfono, «COMPROBANTE DE VENTA — No es factura
electrónica», número de orden, fecha y hora en `settings.timezone`, cliente (o "Walk-in Customer"), forma de pago,
vendedor, tabla de líneas (cantidad/detalle/IVA %/total), subtotal/IVA/descuento/total, cantidad de ítems, **detalle
de impuestos agrupado por tasa** (`taxBreakdown` en `lib/receipt.ts`, tomando la instantánea `order_items.tax_rate`),
pagos, sello **REEMBOLSADA** si aplica, y `receipt_template.header/footer`.
**No es una factura electrónica** (D21, [decisiones pendientes](../06-roadmap/decisiones-pendientes.md)): sin CUFE,
código QR, resolución DIAN ni recibido/cambio (el efectivo entregado no se guarda). `order_items.tax_rate` es una
instantánea de la tasa **realmente cobrada** — **no** interviene en el cálculo (sigue siendo precio × tasa por línea,
redondeado). `create_sale` escribe la tasa que usó para la línea y `_close_tab` la de `tab_items` (congelada al añadir el
producto a la cuenta, no la actual del producto); ambas desde `20260923000004_fix_cross_task_integration.sql`, que
además corrigió las órdenes ya cerradas desde una cuenta. El trigger `before insert` que copia `products.tax_rate`
queda solo como respaldo si alguien inserta sin tasa. Filas anteriores a la migración
`20260923000002_receipt.sql` se rellenaron con `round(tax / nullif(unit_price*quantity - discount, 0), 4)`.

## Reembolso
Botón **Refund** (solo si la orden está `completed` y el rol es gerente+) → diálogo con **motivo obligatorio** (≥ 3 caracteres) → `POST /orders/{id}/refund { reason }` → RPC `refund_order`:

1. Bloquea la fila de la orden (`FOR UPDATE`): dos reembolsos simultáneos se serializan.
2. **Idempotente**: si ya está `refunded`, no hace nada y responde 200 (un reintento tras un corte de red no repone dos veces).
3. Solo reembolsa `completed`; otros estados → 422.
4. Marca `refunded`, `refunded_at`, `refunded_by`, `refund_reason`.
5. Repone el stock de **cada línea** (`coalesce(order_items.stock_taken, quantity)` — una venta offline con
   `stock_shortfall` solo repone lo que de verdad se descontó, nunca la cantidad completa de la línea; las filas
   anteriores a la migración `20260930000001_offline_hardening.sql` no tienen `stock_taken` y siguen usando
   `quantity`, igual que antes) y registra un movimiento `return` con el motivo.
6. El trigger de clientes recalcula `total_spent` y `loyalty_points` (el reembolso los resta).

Verificado, incluido **30 rondas × 8 reembolsos simultáneos** (sin el `FOR UPDATE` la prueba falla con stock duplicado).

## Modelo
`orders(order_number, customer_id, status, subtotal, discount, tax, total, created_by, refunded_*)` — `CHECK (total = subtotal − discount + tax)` en filas nuevas; `order_items`; `payments`.
Estados: `completed` y `refunded` los produce la aplicación; `draft` y `pending` existen en el enum pero **no se usan**. Las órdenes **no se editan ni se borran** (privilegios revocados, incluso al admin).

Desde F2 (offline, ver [pos-checkout](pos-checkout.md) y [offline-y-sincronizacion](../06-roadmap/offline-y-sincronizacion.md)): `client_ref` (mismo valor que la clave de idempotencia del cobro), `occurred_at` (hora del dispositivo; nulo en una venta online), `source` (`online`/`offline`), `sync_issues` (nulo si no hubo incidencias; si no, `occurred_at_clamped`/`price_mismatch`/`stock_shortfall`) y `reviewed_by`/`reviewed_at` (revisión de gerente, F4, ver abajo). El **reporte** (`sales_report`/`dashboard_summary`/`top_selling_products`) agrupa por `coalesce(occurred_at, created_at)`; el listado de `/orders` (`?from&to`, orden por fecha) sigue usando `created_at` (cuándo llegó al servidor), sin cambios.

## Revisión de incidencias de sincronización (F4)

Una orden sincronizada con `sync_issues` no nulo y sin revisar (`reviewed_at is null`) aparece marcada en la lista y
en su detalle muestra una tarjeta con lo que pasó: hora recortada a la ventana offline (`occurred_at_clamped`),
diferencia entre el total mostrado en el POS y el cobrado de verdad (`price_mismatch`) y/o el faltante de stock por
producto (`stock_shortfall`, con un atajo a Inventario). Botón **Mark reviewed** (gerente+) → `PATCH
/api/v1/orders/{id}/review` → RPC `mark_order_reviewed`:

1. Bloquea la fila (`FOR UPDATE`); `P0002` si la orden no existe.
2. Error si `sync_issues` es `null` (no hay nada que revisar).
3. Marca `reviewed_by`/`reviewed_at`. **Idempotente a propósito**: volver a marcarla solo refresca quién y cuándo,
   igual que `refund_order` — no hace falta "des-revisar" antes de corregir el stock, por ejemplo.

`orders`/`order_items`/`payments` siguen sin privilegios de tabla (regla dura 1): esta es la razón de una RPC
dedicada en vez de un `UPDATE` directo desde el servicio, igual que `refund_order`.

## Límites conocidos
- **Reembolso total** únicamente; sin parciales por línea, ventana de tiempo ni autorización escalonada (D8).
- No se registra un pago de devolución (el importe queda implícito en `refunded_*` y el estado).
- La búsqueda es por número de orden, no por nombre de cliente.
- Sin filtro por rango de fechas en la pantalla (la API acepta `from`/`to`), sin exportación.

Relacionados: [POS](pos-checkout.md), [Inventario](inventario.md), [Clientes](clientes.md), [Ajustes](ajustes.md), [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md).
