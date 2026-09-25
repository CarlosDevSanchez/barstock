# Módulo: Proveedores y compras

> Actualizado tras la fase D (recepción de compras) · `app/(dashboard)/suppliers/`, `inventory` · API `purchases`, `suppliers/[id]/history` · RPC `receive_purchase`, `void_purchase`, `supplier_purchase_history` · Confianza: **[Verificado]** (migración, integración `purchases.test.ts`, UI inventario/proveedores en local).

## Proveedores (hecho)
- **Quién:** gerente y admin (los cajeros no ven la sección: `proxy.ts` los redirige, la API responde `403` y RLS devuelve 0 filas). Editar es gerente+; **eliminar es solo admin**, con `ConfirmDialog`.
- Lista paginada con búsqueda por nombre, contacto o email; alta y edición con nombre*, persona de contacto, email, teléfono, dirección y activo/inactivo (`''` → `null`).
- Desde la lista se abre el **historial de compras** (`/suppliers/[id]`).
- `PATCH /suppliers/{id}` y `DELETE /suppliers/{id}` existen en la API y en la UI (botones Editar/Eliminar en la lista).

### Borrado lógico (`deleted_at`)
`DELETE /suppliers/{id}` (solo admin) pone `deleted_at = now()` e `is_active = false`; no borra la fila. `listSuppliers`/`getSupplier` filtran `deleted_at is null`. El trigger `guard_soft_delete` exige admin para cambiar `deleted_at`.

## Recepción de compras (hecho)
Una compra recibida **aumenta stock** y escribe movimientos `purchase` en `inventory_transactions` (con `supplier_id` y `unit_cost`). **No modifica** `products.cost_price`. Si el costo de compra ≠ costo de catálogo, la UI solo muestra un aviso informativo.

| Acción | Quién | Endpoint / RPC |
|---|---|---|
| Recibir compra (1–100 líneas) | gerente+ | `POST /api/v1/purchases` → `receive_purchase` |
| Anular compra recibida | admin | `DELETE /api/v1/purchases/{id}` `{ reason }` → `void_purchase` |
| Historial por proveedor | gerente+ | `GET /api/v1/suppliers/{id}/history?from&to` → `supplier_purchase_history` |

### Reglas de `receive_purchase`
- Proveedor debe existir (`P0002`). Ítems con `quantity > 0`, `unit_cost ≥ 0` y escala monetaria de la tienda (`P0001` si no).
- Si se pasa `cash_session_id`: la sesión debe estar `open` (`FOR UPDATE`); `business_day_id` se toma de la sesión. El total de la OC reduce el efectivo esperado de esa caja (`_session_cash.purchases`).
- Inserta `purchase_orders` con `status = received`, `po_number` `PO-YYMMDD-######`, líneas, suma stock (`variant_id is null`) y movimientos positivos. Fila de inventario ausente → `P0001`.

### Reglas de `void_purchase`
- Motivo obligatorio. Solo `status = received`. Antes de tocar nada, comprueba (por producto, sumando líneas) que hay stock suficiente; si no → `P0001` y stock intacto. Luego resta, escribe movimiento `purchase` negativo (mismo proveedor/costo, `notes` = motivo) y pone `cancelled`.

### Historial
Rango inválido o > 366 días → excepción. Solo OC `received` con `received_at` en `[from, to+1)` en la zona horaria de `settings` (igual que `sales_report`). JSON: `purchases`, `total`, `products` (`last_unit_cost` = `unit_price` de la recepción más reciente; `average_unit_cost` = Σ(qty×price)/Σ(qty)).

### UI
- **Inventario:** con delta positivo en el ajuste, opción «Entrada de proveedor»; botón «Registrar compra» para varias líneas.
- **Proveedores → detalle:** historial + anulación (admin).

## Escrituras
Las políticas de escritura directa sobre `purchase_orders` / `purchase_order_items` están revocadas: solo los RPC `security definer` escriben. SELECT sigue siendo gerente+.

Relacionados: [Inventario](inventario.md), [Caja y jornada](caja-y-jornada.md), [Gastos](gastos.md), [esquema](../02-base-de-datos/01-esquema-tablas.md).
