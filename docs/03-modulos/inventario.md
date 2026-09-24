# Módulo: Inventario

> Actualizado tras la fase D · `app/(dashboard)/inventory/page.tsx` · API `inventory`, `inventory/[id]/adjust`, `purchases` · RPC `adjust_inventory`, `receive_purchase` · Confianza: **[Verificado]** (incluye recepción de compras vía `receive_purchase`).

## Quién puede qué
| Rol | Ver | Ajustar stock | Recibir compra |
|---|---|---|---|
| cajero | ✅ | ❌ | ❌ |
| gerente, admin | ✅ | ✅ (`adjust_inventory`, `set_low_stock_threshold`) | ✅ (`receive_purchase`) |

## Cómo cambia el stock (la única vía)
El stock **no se puede escribir directamente** (privilegios `INSERT/UPDATE/DELETE` revocados sobre `inventory` e `inventory_transactions`, incluso al admin). Cambia solo por:

| Origen | Movimiento en `inventory_transactions` |
|---|---|
| Venta (`create_sale`) | `sale`, cantidad negativa, `reference_id` = orden |
| Reembolso (`refund_order`) | `return`, positiva, `reference_id` = orden |
| Ajuste manual (`adjust_inventory`) | `adjustment`, con el **motivo** en `notes` |
| Compra a proveedor (`receive_purchase`) | `purchase`, positiva, `reference_id` = OC, `supplier_id`, `unit_cost` |
| Anulación de compra (`void_purchase`) | `purchase`, negativa, mismo proveedor/costo, motivo en `notes` |

Reglas: nunca negativo (`CHECK` + `UPDATE … WHERE quantity + delta >= 0`); un ajuste exige motivo (≥ 3 caracteres) y cambio distinto de 0; concurrente seguro. **La recepción no actualiza `products.cost_price`.**

## Pantalla
- Tarjetas (calculadas por el servidor sobre **todo** el conjunto filtrado, no solo la página): **unidades totales**, **stock bajo** y **valor del stock a costo**.
- Sección **Paquetes vendibles** (solo lectura): promociones activas con `available = floor(min(stock_i / qty_i))` y receta+stock por componente.
- Lista paginada con búsqueda por nombre/SKU y filtro "Low stock only". **Stock bajo = `quantity <= low_stock_threshold`**.
- Gerente/admin: botón de ajuste → diálogo con **cambio** y **motivo**; si el delta es **positivo**, opción **Entrada de proveedor** (proveedor, costo unitario, factura, caja opcional) que llama a `receive_purchase` con una línea.
- Gerente/admin: **Registrar compra** (varias líneas) en la cabecera.
- Si el costo de compra ≠ `cost_price` del catálogo, aviso informativo (sin escribir el costo).
- Gerente/admin: lápiz junto al umbral → `PATCH /api/v1/inventory/{id}`.

## Datos
`inventory(product_id, variant_id, quantity, low_stock_threshold, location, last_restocked_at)`. Índice único parcial para (`product_id`, sin variante). Cada producto nuevo recibe su fila (cantidad 0, umbral = `settings.low_stock_threshold` o 10).
`last_restocked_at` se actualiza en los ajustes positivos y al recibir compras.
`inventory_transactions` admite `supplier_id` y `unit_cost` en movimientos de compra.

## Límites conocidos
- `location` no tiene UI. Las variantes tienen fila de inventario pero no se venden ni se crean desde la UI.
- Sin historial de movimientos en pantalla (la tabla existe; el historial de compras vive en `/suppliers/[id]`).
- El resumen y el filtro de stock bajo operan sobre hasta 1000 filas (tope de PostgREST).
- Sin conteos cíclicos.

Relacionados: [Proveedores y compras](proveedores-y-compras.md), [POS](pos-checkout.md), [Órdenes](ordenes-y-reembolsos.md), [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md).
