# Triggers y funciones

> **Estado: implementado** (etapa 1 + `…06_locale_and_money` + etapa 2 `…07_top_products`/`…08_tabs`; migraciones `…02`–`…08`). Confianza: **[Verificado]** con SQL y contra la API real.
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
- Entrada: hasta 100 líneas, cada una `{product_id, variant_id?, quantity, discount?}` **o** `{promotion_id, quantity}`
  (nunca ambos). Tras expandir paquetes, ≤ 200 líneas de orden. **Precio y tasa se leen de la BD** (o se asignan en
  expansión de promo); cualquier `unit_price`/`total` del cliente se ignora.
- Promos: valida activa/`deleted_at` null y componentes activos; reparte `package_price × qty` (espejo de
  `lib/promotion-allocate.ts`); inserta `order_items` con `promotion_id` y `unit_price` asignado (no el de catálogo).
- Escala monetaria: `money_scale()` lee `settings.currency` (0 en COP, 2 en USD, etc.).
- Por línea: `base = precio × cantidad − descuento de línea`; `impuesto = round(base × tax_rate, money_scale)`. Total =
  `Σ base + Σ impuesto − descuento global` (D3).
- Stock: `UPDATE inventory … WHERE quantity >= n` atómico; líneas procesadas **ordenadas** por producto (sin deadlocks).
- Crea `orders` (`completed`), `order_items`, un `payments` y un movimiento `sale` por línea.
- Rechaza: carrito vacío, demasiadas líneas, cantidad ≤ 0, promo no vendible, stock insuficiente, etc.
- Número de orden: `ORD-YYMMDD-NNNNNN` con `order_number_seq`.

### `refund_order(p_order_id, p_reason) → void` — gerente+
- Motivo obligatorio (≥ 3 caracteres). Bloquea la orden (`FOR UPDATE`). **Idempotente**: si ya está `refunded` no hace nada (no repone dos veces).
  Solo reembolsa órdenes `completed`.
- Repone el stock de cada línea y registra `return` en `inventory_transactions`. Guarda `refunded_at`, `refunded_by`, `refund_reason` en `orders`.
- Reembolso **total**; el parcial es una evolución (D8).

### `adjust_inventory(p_inventory_id, p_delta, p_reason) → int` — gerente+
- Delta distinto de 0, motivo obligatorio. `UPDATE … WHERE quantity + delta >= 0` (nunca negativo). Registra `adjustment`. Devuelve la nueva cantidad.

### `top_selling_products(p_days default 30, p_limit default 5) → table(...)` — cajero+, `SECURITY DEFINER` (`…07`)
A diferencia de `dashboard_summary`/`sales_report` (abajo), que son `INVOKER` y respetan que un cajero solo vea sus propias ventas, esta es
`SECURITY DEFINER` a propósito: la venta rápida del POS necesita la **moda de toda la tienda**, no solo lo que vendió quien está atendiendo.
Solo devuelve agregados de producto (nombre, precio, stock, unidades vendidas) — nunca datos de orden, cliente ni pago — así que ampliar su
alcance es seguro. Excluye reembolsos (`status = 'completed'`), respeta la ventana de días (máx. 366) y el límite (máx. 20).

## Cuentas abiertas (`…08`) — la única vía para escribir `tabs`/`tab_items`/`tab_payments`

Mismo patrón que las RPC de negocio de arriba (`SECURITY DEFINER`, `search_path=''`, errores `P0001`/`P0002`/`42501`); documentadas en detalle
en [cuentas-abiertas](../03-modulos/cuentas-abiertas.md). Todas bloquean la cuenta con `SELECT … FOR UPDATE` antes de tocar nada:
`open_tab`, `tab_add_members`, `tab_add_items` (cajero+); `tab_remove_item`, `void_tab` (gerente+); `tab_set_discount`, `tab_pay` (cajero+).
Dos internas sin `GRANT` a nadie: `_tab_totals` (la fórmula de `create_sale` aplicada a `tab_items`) y `_close_tab` (convierte la cuenta pagada
en una `orders` normal). `tab_summary(p_tab_id)` expone `_tab_totals` de solo lectura para el endpoint de detalle.

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
| `audit_row_change` (`AFTER INSERT OR UPDATE OR DELETE`) | `products`, `categories`, `promotions`, `promotion_items`, `inventory`, `orders`, `customers`, `suppliers`, `settings`, `profiles`, `tabs`, `tab_items`, `tab_payments` | Escribe una fila en `audit_log` con el actor (de `auth.uid()`/`profiles`, o `system` sin JWT), la acción y, en un `UPDATE`, solo las columnas que cambiaron (`{before, after}`, sin `updated_at`). Un `UPDATE` que no cambia nada no genera fila. `…0016` |
| `audit_log_immutable` (`BEFORE UPDATE OR DELETE`, `BEFORE TRUNCATE`) | `audit_log` | Lanza `raise exception` siempre, para cualquier rol (incluido `service_role`): es la capa que hace el log append-only. `…0016` |

### `log_auth_event(p_action text, p_metadata jsonb default '{}') → void` — cualquier usuario, `SECURITY DEFINER` (`…0016`)

Registra un evento de sesión (`login`, `logout`, `invite`, `password_reset`) en `audit_log`. El actor es siempre
`auth.uid()`: la función lo lee del JWT y **no acepta un parámetro para forjarlo**. Un `login_failed` no pasa por aquí
(no hay sesión todavía): el servidor lo inserta con el cliente `service_role`. Ver [Auditoría](../03-modulos/auditoria.md).

## Jornada y cajas (`20261003000001`)

`open_business_day`, `close_business_day`, `adjust_business_day` (admin), `open_cash_session`, `add_cash_movement`, `close_cash_session`, `cash_session_summary`, `business_day_report` (gerente+) y `refresh_business_days`. `_auto_close_stale_business_days` no se concede a `authenticated`: solo a `service_role` (el cron) y la llaman por dentro las funciones de venta y de apertura. `create_sale`, `_close_tab`, `tab_pay` y `tab_pay_split` solo añaden esa llamada y las columnas de jornada/caja. Cada tabla nueva tiene el trigger `audit_row_change`.

## Ausencias conocidas

- No hay trigger que cree inventario para **variantes** (las variantes no se venden desde el POS todavía, D10).
- `purchase_orders` no repone stock al recibirse (sin UI, etapa 2).
