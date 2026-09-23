# Módulo: Inventario

> Actualizado tras la etapa 1 · `app/(dashboard)/inventory/page.tsx` · API `inventory`, `inventory/[id]/adjust` · Servicio `services/inventory.ts` · RPC `adjust_inventory` · Confianza: **[Verificado]** (`sales.test.ts`, `rpc.test.ts`, `rls.test.ts`, e2e).

## Quién puede qué
| Rol | Ver | Ajustar stock |
|---|---|---|
| cajero | ✅ | ❌ |
| gerente, admin | ✅ | ✅ (`adjust_inventory`) |

## Cómo cambia el stock (la única vía)
El stock **no se puede escribir directamente** (privilegios `INSERT/UPDATE/DELETE` revocados sobre `inventory` e `inventory_transactions`, incluso al admin). Cambia solo por:

| Origen | Movimiento en `inventory_transactions` |
|---|---|
| Venta (`create_sale`) | `sale`, cantidad negativa, `reference_id` = orden |
| Reembolso (`refund_order`) | `return`, positiva, `reference_id` = orden |
| Ajuste manual (`adjust_inventory`) | `adjustment`, con el **motivo** en `notes` |
| Compra a proveedor | `purchase` (**sin implementar**, etapa 2) |

Reglas: nunca negativo (`CHECK` + `UPDATE … WHERE quantity + delta >= 0`); un ajuste exige motivo (≥ 3 caracteres) y cambio distinto de 0; concurrente seguro.

## Pantalla
- Tarjetas (calculadas por el servidor sobre **todo** el conjunto filtrado, no solo la página): **unidades totales**, **stock bajo** y **valor del stock a costo**.
- Sección **Paquetes vendibles** (solo lectura): promociones activas con `available = floor(min(stock_i / qty_i))` y receta+stock por componente. Tabla con **altura máxima + scroll** (no alarga toda la página si hay muchas promos). No se ajusta stock de paquetes aquí — se ajusta el de cada producto. Ver [Promociones](promociones.md).
- Lista paginada con búsqueda por nombre/SKU y filtro "Low stock only". **Stock bajo = `quantity <= low_stock_threshold`** de **cada fila** (antes: `< 10` fijo y topado en 5).
- Gerente/admin: botón de ajuste → diálogo con **cambio (unidades, + o −)** y **motivo**; el `toast` confirma la nueva cantidad o explica el rechazo ("would make the stock negative").

## Datos
`inventory(product_id, variant_id, quantity, low_stock_threshold, location, last_restocked_at)`. Índice único parcial para (`product_id`, sin variante). Cada producto nuevo recibe su fila (cantidad 0, umbral = `settings.low_stock_threshold` o 10).
`last_restocked_at` se actualiza en los ajustes positivos.

## Límites conocidos
- El **umbral** por artículo no se puede editar desde la UI ni la API (solo se toma de Ajustes al crear el producto).
- `location` no tiene UI. Las variantes tienen fila de inventario pero no se venden ni se crean desde la UI.
- Sin historial de movimientos en pantalla (la tabla existe y la lee gerente+ por RLS, sin endpoint).
- El resumen y el filtro de stock bajo operan sobre hasta 1000 filas (tope de PostgREST).
- Sin conteos cíclicos ni recepción de compras.

Relacionados: [POS](pos-checkout.md), [Órdenes](ordenes-y-reembolsos.md), [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md), [testing](../05-guias/testing.md) (concurrencia).
