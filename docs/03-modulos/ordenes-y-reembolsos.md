# Módulo: Órdenes y reembolsos

> Actualizado tras la etapa 1 · `app/(dashboard)/orders/page.tsx`, `orders/[id]/page.tsx` · API `orders`, `orders/[id]`, `orders/[id]/refund` · RPC `refund_order` · Confianza: **[Verificado]** (`sales.test.ts`, `rpc.test.ts`, `rls.test.ts`, e2e).

## Quién ve qué
| Rol | Lista y detalle | Reembolsar |
|---|---|---|
| cajero | **Solo las órdenes que creó** (RLS por `created_by`); las ajenas dan `404` | ❌ |
| gerente, admin | Todas | ✅ |

Las líneas (`order_items`) y los pagos (`payments`) heredan la visibilidad de su orden.

## Lista
Paginada (25), ordenada por fecha; búsqueda por **número de orden** (`ORD-YYMMDD-NNNNNN`) y filtro por estado (`completed`, `refunded`). Al pulsar una fila se abre el detalle.

## Detalle
Datos de la orden, quién la creó (nombre o email), cliente (o "Walk-in"), método y monto del pago, líneas con precio, descuento, impuesto y total, y el resumen (subtotal, impuesto, descuento, total).
"Print" usa `window.print()` (no hay plantilla de recibo). Una orden reembolsada muestra fecha y **motivo** del reembolso.

## Reembolso
Botón **Refund** (solo si la orden está `completed` y el rol es gerente+) → diálogo con **motivo obligatorio** (≥ 3 caracteres) → `POST /orders/{id}/refund { reason }` → RPC `refund_order`:

1. Bloquea la fila de la orden (`FOR UPDATE`): dos reembolsos simultáneos se serializan.
2. **Idempotente**: si ya está `refunded`, no hace nada y responde 200 (un reintento tras un corte de red no repone dos veces).
3. Solo reembolsa `completed`; otros estados → 422.
4. Marca `refunded`, `refunded_at`, `refunded_by`, `refund_reason`.
5. Repone el stock de **cada línea** y registra un movimiento `return` con el motivo.
6. El trigger de clientes recalcula `total_spent` y `loyalty_points` (el reembolso los resta).

Verificado, incluido **30 rondas × 8 reembolsos simultáneos** (sin el `FOR UPDATE` la prueba falla con stock duplicado).

## Modelo
`orders(order_number, customer_id, status, subtotal, discount, tax, total, created_by, refunded_*)` — `CHECK (total = subtotal − discount + tax)` en filas nuevas; `order_items`; `payments`.
Estados: `completed` y `refunded` los produce la aplicación; `draft` y `pending` existen en el enum pero **no se usan**. Las órdenes **no se editan ni se borran** (privilegios revocados, incluso al admin).

## Límites conocidos
- **Reembolso total** únicamente; sin parciales por línea, ventana de tiempo ni autorización escalonada (D8).
- No se registra un pago de devolución (el importe queda implícito en `refunded_*` y el estado).
- La búsqueda es por número de orden, no por nombre de cliente.
- Sin filtro por rango de fechas en la pantalla (la API acepta `from`/`to`), sin exportación.

Relacionados: [POS](pos-checkout.md), [Inventario](inventario.md), [Clientes](clientes.md), [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md).
