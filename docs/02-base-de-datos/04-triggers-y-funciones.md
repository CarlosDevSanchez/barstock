# Triggers y funciones

> **Estado: implementado** (etapa 1 + `…06_locale_and_money`; migraciones `…02`–`…06`). Confianza: **[Verificado]** con SQL y contra la API real.
> Convención: toda función `SECURITY DEFINER` fija `search_path = ''` y califica sus objetos; a todas se les revoca `EXECUTE` a `anon`
> (Supabase se lo concede por defecto) y las de trigger a todos los roles.

## Funciones de rol (`…03`)

| Función | Qué hace |
|---|---|
| `current_app_role()` | Rol del usuario del JWT, o `NULL` si no hay usuario, perfil o está inactivo |
| `has_min_role(rol)` | `true` si el rol actual es ≥ `rol` (jerárquico). Es lo que usan todas las políticas |

## RPC de negocio (`…04`) — la única vía para escribir ventas y stock

Todas re-comprueban el rol dentro (no dependen solo de que la API lo haga), corren en **una transacción** y lanzan errores de negocio con
`RAISE EXCEPTION` (`P0001`, mensaje apto para el usuario), `P0002` (no encontrado) o `42501` (sin permiso).

### `create_sale(p_customer_id, p_items jsonb, p_payment_method, p_discount default 0) → uuid` — cajero+
- Entrada: solo ids y cantidades (`[{product_id, variant_id?, quantity, discount?}]`). **Precio y tasa de impuesto se leen de la BD**;
  cualquier `unit_price`/`total` enviado se ignora. La variante debe pertenecer al producto.
- Escala monetaria: `money_scale()` lee `settings.currency` (0 en COP, 2 en USD, etc.). Precios, descuentos e impuestos se redondean a esa escala;
  se rechaza precisión de más (p. ej. centavos en COP).
- Por línea: `base = precio × cantidad − descuento de línea`; `impuesto = round(base × tax_rate, money_scale)`. Total de la orden =
  `Σ base + Σ impuesto − descuento global` (el descuento global se aplica **después** del impuesto; supuesto D3).
- Stock: `UPDATE inventory … WHERE quantity >= n` atómico. Dos ventas concurrentes del último ítem se serializan por el bloqueo de fila y
  una falla con `Insufficient stock for "<producto>"`. Las líneas se procesan **ordenadas** por producto para que ventas concurrentes bloqueen
  filas en el mismo orden (sin deadlocks).
- Crea `orders` (estado `completed`), `order_items`, un `payments` por el total y una fila `sale` en `inventory_transactions` por línea.
- Rechaza: carrito vacío (o > 200 líneas), cantidad ≤ 0, descuentos negativos o con más decimales que la escala, cliente inactivo, producto
  inactivo/borrado, descuento mayor que la línea o que el total, producto sin fila de inventario (D9).
- Número de orden: `ORD-YYMMDD-NNNNNN` con `order_number_seq`.

### `refund_order(p_order_id, p_reason) → void` — gerente+
- Motivo obligatorio (≥ 3 caracteres). Bloquea la orden (`FOR UPDATE`). **Idempotente**: si ya está `refunded` no hace nada (no repone dos veces).
  Solo reembolsa órdenes `completed`.
- Repone el stock de cada línea y registra `return` en `inventory_transactions`. Guarda `refunded_at`, `refunded_by`, `refund_reason` en `orders`.
- Reembolso **total**; el parcial es una evolución (D8).

### `adjust_inventory(p_inventory_id, p_delta, p_reason) → int` — gerente+
- Delta distinto de 0, motivo obligatorio. `UPDATE … WHERE quantity + delta >= 0` (nunca negativo). Registra `adjustment`. Devuelve la nueva cantidad.

## Reportes (`…05`) — `SECURITY INVOKER`

Corren con el RLS del que llama: el dashboard de un cajero solo suma **sus** ventas; el de un gerente, todas.

| Función | Rol | Contenido |
|---|---|---|
| `dashboard_summary(p_tz)` | cajero+ | Ingresos y órdenes de hoy, ingresos del mes, clientes, **conteo exacto** de stock bajo (umbral **por fila**, `quantity <= low_stock_threshold`), ventas de 7 días, top 5 productos (30 días) y 5 artículos con stock bajo |
| `sales_report(p_from, p_to, p_tz)` | gerente+ | Totales, promedio, serie diaria, top 10 productos, top 5 clientes y desglose por método de pago. Máx. 366 días |

Solo cuentan órdenes `completed` (los reembolsos se excluyen). Los días se agrupan en la zona horaria de `settings.timezone` (por defecto `America/Bogota`).

## Triggers

| Trigger | Tabla | Qué hace |
|---|---|---|
| `update_<tabla>_updated_at` | varias | Mantiene `updated_at` (original) |
| `on_auth_user_created` → `handle_new_user` | `auth.users` | Crea el perfil. Rol solo de `app_metadata`; **activo solo si el servidor asignó rol** |
| `on_auth_user_app_metadata_role_changed` → `sync_profile_role_from_app_metadata` | `auth.users` | Aplica el rol cuando la clave `role` de `app_metadata` cambia (GoTrue la escribe en un `UPDATE` posterior al `INSERT`) |
| `protect_profile_columns` | `profiles` | `id`/`email` inmutables; solo admin cambia `role`/`is_active`; protege al último admin |
| `create_inventory_for_product` | `products` | Crea la fila de inventario (cantidad 0, umbral de `settings.low_stock_threshold` o 10). El seed fija cantidades iniciales |
| `orders_refresh_customer_totals` | `orders` | Recalcula `customers.total_spent` (Σ órdenes `completed`) y `loyalty_points = floor(total_spent)` (D7). Los reembolsos restan |

## Ausencias conocidas

- No hay trigger que cree inventario para **variantes** (las variantes no se venden desde el POS todavía, D10).
- `purchase_orders` no repone stock al recibirse (sin UI, etapa 2).
