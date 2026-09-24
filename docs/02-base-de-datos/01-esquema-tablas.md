# Esquema de tablas

> Esquema **efectivo** tras las 8 migraciones de `supabase/migrations/` (extraído de la BD local con `information_schema`, `pg_constraint` y `pg_indexes`). Confianza: **[Verificado]**.
> El esquema original (`supabase/legacy/schema.sql`) es la migración *baseline*; las diferencias con él están al final. Los tipos de TypeScript se **generan** de este esquema (`bun run db:types`).

Convenciones: PK `id uuid default uuid_generate_v4()`; todas las tablas tienen RLS ([políticas](03-rls-y-politicas.md)); `created_at`/`updated_at timestamptz NOT NULL default now()` (con trigger de `updated_at`).
Los importes son `NUMERIC(14,2)` (hasta ≈ 10¹²). En COP y otras monedas de unidad entera los precios se guardan enteros (la API y `create_sale` rechazan centavos de más). Ningún cliente de la API escribe directamente `orders`, `order_items`, `payments`, `inventory` ni `inventory_transactions` (solo RPC).

## Tipos enumerados
| Enum | Valores |
|---|---|
| `user_role` | `admin`, `manager`, `cashier` |
| `payment_method` | `cash`, `card`, `ewallet` |
| `order_status` | `draft`, `pending`, `completed`, `refunded` (**la aplicación solo produce `completed` y `refunded`**) |
| `po_status` | `draft`, `pending`, `received`, `cancelled` (sin uso: compras sin UI) |
| `tab_status` | `open`, `closed`, `voided` |

## Usuarios
**`profiles`** — `id` → `auth.users` (**ON DELETE CASCADE**), `email` UNIQUE NOT NULL, `full_name`, `role user_role NOT NULL default 'cashier'`, `avatar_url`, `phone`, **`is_active` NOT NULL default true**, **`locale` text NOT NULL default `'es'` `CHECK IN ('es','en')`** (idioma de la UI; cada usuario puede cambiar el suyo).
Lo crea un trigger al nacer el usuario; el rol solo lo cambia un admin (trigger); `id` y `email` son inmutables por la API. Ver [RLS](03-rls-y-politicas.md#alta-de-usuarios-cerrada-por-defecto).

## Catálogo
**`categories`** — `name` NOT NULL, `description`, `parent_id` → `categories` (jerarquía; sin UI).

**`products`** — `name` NOT NULL, `description`, `sku` UNIQUE NOT NULL, `barcode` UNIQUE, `category_id` → `categories`, `cost_price` y `selling_price` `NUMERIC(14,2)` NOT NULL default 0 (`CHECK ≥ 0`),
**`tax_rate` `NUMERIC(6,4)` NOT NULL default 0 (`CHECK 0–1`, fracción)**, `image_url` (columna vieja, en desuso, ya no se escribe),
**`image_key`** (Fase 6: clave de R2, `CHECK image_key ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'`, generada por el
servidor — ver [productos](../03-modulos/productos.md#imagenes-de-producto)), `is_active` NOT NULL default true, **`deleted_at`**
(borrado lógico). Un trigger crea su fila de `inventory`.

**`product_variants`** — `product_id` → `products` CASCADE NOT NULL, `name`, `variant_type` (texto libre: "size", "color"), `sku` UNIQUE, `barcode` UNIQUE, `cost_price`, `selling_price` (nullables, `CHECK ≥ 0`). Sin UI ni venta desde el POS (D10).

**`promotions`** — paquetes multi-producto a precio fijo: `name` NOT NULL, `package_price` `NUMERIC(14,2)` NOT NULL (`CHECK ≥ 0`), `is_active` NOT NULL default true, **`deleted_at`** (borrado lógico como productos; sin hard delete desde la API). Sin stock propio: la disponibilidad se deriva de los componentes. Esquema en `20260924000001`; API + UI admin en `/promotions` (gerente+); venta en POS vía expansión en `create_sale` (`20260924000002`).

**`promotion_items`** — `promotion_id` → `promotions` CASCADE NOT NULL, `product_id` → `products` NOT NULL, `quantity` (`CHECK ≥ 1`), `UNIQUE (promotion_id, product_id)`.

## Inventario
**`inventory`** — `product_id` → `products` CASCADE NOT NULL, `variant_id` → `product_variants` CASCADE (NULL = producto sin variante), **`quantity` NOT NULL default 0 `CHECK ≥ 0`**,
`low_stock_threshold` NOT NULL default 10 (`CHECK ≥ 0`), `location`, `last_restocked_at`. Único por (`product_id`, `variant_id`) **y** por `product_id` cuando `variant_id IS NULL` (índice parcial; `UNIQUE` a secas no impide duplicados con NULL).

**`inventory_transactions`** — bitácora de movimientos: `inventory_id` → `inventory` CASCADE NOT NULL, `transaction_type` **`CHECK IN ('purchase','sale','adjustment','return')`**, `quantity` (`CHECK ≠ 0`; negativo = salida),
`reference_id` (orden o compra; **sin FK**), `notes`, `created_by` → `auth.users`. Solo la escriben los RPC.

## Personas
**`customers`** — `name` NOT NULL, `email` UNIQUE, `phone`, `address`, **`loyalty_points`** y **`total_spent`** NOT NULL default 0 (**derivados por trigger** de las órdenes `completed`; no escribibles por la API), `is_active` NOT NULL default true.

**`suppliers`** — `name` NOT NULL, `contact_person`, `email`, `phone`, `address`, `notes`, `is_active` NOT NULL default true.

## Ventas
**`orders`** — `order_number` UNIQUE NOT NULL (`ORD-YYMMDD-NNNNNN`, secuencia `order_number_seq`), `customer_id` → `customers` (NULL = mostrador), `status` NOT NULL default `pending`, `subtotal`, `discount`, `tax`, `total` NOT NULL,
`notes`, `created_by` → `auth.users`, **`refunded_at`, `refunded_by` → `auth.users`, `refund_reason`**. `CHECK` importes ≥ 0 y **`total = subtotal − discount + tax`** (`NOT VALID`: se exige en filas nuevas; validar tras depurar datos antiguos).
Offline (F2): `client_ref UUID UNIQUE` (nullable; misma clave que la idempotencia del cobro), `occurred_at timestamptz` (nullable; hora del dispositivo), `source text NOT NULL default 'online' CHECK IN ('online','offline')`, `sync_issues jsonb` (nullable), `reviewed_by/reviewed_at` (reservados para F4).

**`order_items`** — `order_id` → `orders` CASCADE NOT NULL, `product_id` → `products` NOT NULL, `variant_id`, **`promotion_id` → `promotions` (nullable; líneas nacidas de un paquete; permite promo soft-deleted)**, `quantity` (`CHECK > 0`), `unit_price`, `discount`, `tax`, `total`, **`unit_cost`** (`NUMERIC(14,2)`, nullable: foto de `products.cost_price` al vender; las líneas anteriores quedan en null). `CHECK` importes ≥ 0 y **`total = unit_price × quantity − discount + tax`** (`NOT VALID`). Guarda el **precio con el que se vendió**.

**`payments`** — `order_id` → `orders` CASCADE NOT NULL, `payment_method` NOT NULL, `amount` (`CHECK ≥ 0`), `reference_number`, `notes`. Una orden nacida de una venta directa tiene un pago; una nacida de una
cuenta ([cuentas-abiertas](../03-modulos/cuentas-abiertas.md)) puede tener varios (uno por cada pago parcial). `orders.tab_id` → `tabs` (NULL en una venta directa).

## Cuentas abiertas (`tabs`)
Ver [cuentas-abiertas](../03-modulos/cuentas-abiertas.md) para el flujo completo. Solo lectura desde la API (`cashier+`); toda escritura pasa por RPC (`0008_tabs.sql`).

**`tabs`** — `tab_number` UNIQUE NOT NULL (`TAB-000123`, secuencia `tab_number_seq`), `label` NOT NULL (`CHECK` no vacío), `customer_id` → `customers` (opcional), `status tab_status NOT NULL default 'open'`,
`discount NUMERIC(14,2) NOT NULL default 0 (CHECK ≥ 0)`, `order_id` → `orders` (se rellena al cerrar), `opened_by`/`closed_by`/`voided_by` → `auth.users`, `void_reason`, `opened_at`/`closed_at`/`voided_at`.
`CHECK`: `closed` exige `order_id`; `voided` exige `void_reason`. Índice parcial en `opened_at` `WHERE status = 'open'`.

**`tab_members`** — `tab_id` → `tabs` CASCADE NOT NULL, `display_name` NOT NULL (`CHECK` no vacío), `customer_id` → `customers` (opcional). Las personas entre las que se divide la cuenta.

**`tab_items`** — `tab_id` → `tabs` CASCADE NOT NULL, `product_id` → `products` NOT NULL, `variant_id` → `product_variants`, `promotion_id` → `promotions` (nullable), `quantity` (`CHECK > 0`), `unit_price`, `tax_rate`, `discount` (foto al primer añadido; unique `nulls not distinct (tab_id, product_id, variant_id, promotion_id)`),
`added_by` → `auth.users`. `UNIQUE NULLS NOT DISTINCT (tab_id, product_id, variant_id)` (Postgres 17): añadir de nuevo el mismo producto suma cantidad en vez de crear otra fila.

**`tab_payments`** — `tab_id` → `tabs` CASCADE NOT NULL, `member_id` → `tab_members` (opcional: un pago puede no asignarse a nadie en particular), `payment_method` NOT NULL, `amount` (`CHECK > 0`), `created_by` → `auth.users`.

## Compras (solo esquema) y gastos
**`purchase_orders`** (`po_number` UNIQUE, `supplier_id`, `status`, `total_amount ≥ 0`, `ordered_by`/`received_by`, fechas) · **`purchase_order_items`** (`purchase_order_id`, `product_id` NOT NULL, `variant_id`, `quantity > 0`, `unit_price ≥ 0`, `total` **GENERATED** `quantity × unit_price`) · **`expense_categories`** (`name` UNIQUE, `is_active`; semilla: Arriendo, Servicios, Nómina, Insumos, Otros) · **`expenses`** (`category_id` → `expense_categories`, `description`, `amount ≥ 0`, `payment_method`, `supplier_id` opcional, `business_day_id`, `cash_session_id`, `occurred_at`, `deleted_at`, `void_reason`, `created_by`). La columna de texto `category` y la fecha `date` se migraron a «Otros» (el texto original queda en `description`) y a `occurred_at`. Ver [Gastos](../03-modulos/gastos.md).

## Configuración
**`settings`** — `key` UNIQUE NOT NULL, `value jsonb NOT NULL`. Una fila por clave (`store_name`, `currency`, `timezone`, `tax_rate`, `low_stock_threshold`, `receipt_template`…). Ver [Ajustes](../03-modulos/ajustes.md).

## Auditoría
**`audit_log`** — `id bigint identity`, `occurred_at`, `actor_id` (**sin FK**), `actor_email`, `actor_role`, `action CHECK IN ('insert','update','delete','login','login_failed','logout','invite','password_reset')`, `entity`, `entity_id`, `changes jsonb`, `source CHECK IN ('db','api')`. Append-only: sin política de escritura, privilegios revocados y triggers que bloquean `UPDATE`/`DELETE`/`TRUNCATE` incluso para `service_role`. Ver [Auditoría](../03-modulos/auditoria.md).

## Idempotencia
**`idempotency_keys`** — `key uuid PK` (la manda el cliente, cabecera `Idempotency-Key`), `user_id NOT NULL`, `action text NOT NULL`, `request_hash text NOT NULL`, `result jsonb` (nulo hasta que la llamada dueña termina, en la misma transacción), `created_at`. Sin política RLS (solo la usan las RPC `SECURITY DEFINER`) y `revoke all` de `anon`/`authenticated`. Hoy solo la usa `create_sale` (evita el doble cobro de un reintento de red); ver [pos-checkout](../03-modulos/pos-checkout.md) y [F0 del diseño offline](../06-roadmap/offline-y-sincronizacion.md).

## Diferencias respecto a la baseline
| Cambio | Migración |
|---|---|
| `profiles.is_active`, `products.deleted_at`, `orders.refunded_*` | `…02`, `…04` |
| `products.tax_rate` `DECIMAL(5,2)` → `NUMERIC(6,4)` NOT NULL con `CHECK 0–1` | `…02` |
| `CHECK` de cantidades, precios e importes; aritmética de órdenes y líneas; tipos de movimiento | `…02` |
| `NOT NULL` en FKs de pertenencia (`inventory.product_id`, `order_items.order_id/product_id`, `payments.order_id`, `product_variants.product_id`, `purchase_order_items.*`) y en `created_at`/`updated_at`/booleanos con default | `…02` |
| Índice único parcial de inventario sin variante; `profiles.id ON DELETE CASCADE` | `…02` |
| Secuencia de órdenes; triggers de inventario y totales de clientes | `…04` |
| `profiles.locale`; importes → `NUMERIC(14,2)`; `currency_decimals` / `money_scale`; `create_sale` redondea según la moneda | `…06` |
| `top_selling_products` (RPC, `SECURITY DEFINER`): mode de venta de toda la tienda para el POS | `…0007` |
| `tabs`, `tab_members`, `tab_items`, `tab_payments`, `orders.tab_id`, enum `tab_status` y sus RPC | `…0008` |
| `promotions`, `promotion_items`, `order_items.promotion_id` (soft-delete; sin hard delete API) | `20260924000001` |
| `audit_log` (append-only), trigger genérico en 13 tablas, `log_auth_event` RPC | `20260926000001` |
| `idempotency_keys`; `create_sale` gana `p_idempotency_key` (drop + recreate, firma antigua eliminada) | `20260927000001` |
| `orders.client_ref/occurred_at/source/sync_issues/reviewed_by/reviewed_at`; `create_sale` gana `p_occurred_at`/`p_expected_total` (drop + recreate); `dashboard_summary`/`sales_report`/`top_selling_products` agrupan por `coalesce(occurred_at, created_at)`; setting `offline_max_hours` | `20260928000001` |
| `mark_order_reviewed` (RPC, `SECURITY DEFINER`, gerente+): marca `orders.reviewed_by/reviewed_at` para una orden con `sync_issues`; idempotente | `20260929000001` |
| `order_items.stock_taken`; `create_sale` endurecido (hash de idempotencia sin `occurred_at`/`expected_total`, revisado antes que cliente/producto; venta de mostrador y precio de último valor conocido en vez de rechazar; descuento recortado; `sync_issues.offline_sale` obligatorio); `refund_order` usa `coalesce(stock_taken, quantity)`; `audit_log` acepta `action = 'discard'`; `log_outbox_discard` (RPC, gerente+) — tras revisión adversarial de F0-F4 | `20260930000001` |
| `order_items.stock_taken` gana `CHECK` de rango; `create_sale`: `sync_issues.customer_unavailable`/`.stale_pricing` pasan de booleano a detalle (id del cliente pedido, ids de productos/promociones obsoletos); `log_outbox_discard` (drop + recreate) gana `p_client_ref` (rechaza con 409 si ya existe una orden con esa clave) y `p_owner_user_id`, y `p_payment_method` pasa de `text` al enum real — tras una segunda revisión adversarial | `20261001000001` |
| `inventory.low_stock_threshold`; RPC `set_low_stock_threshold` (gerente+) | `20261002000001` |
| `create_sale` y `tab_pay_split` aceptan 1 o 2 pagos (`p_payments`); `sales_report` cuenta órdenes distintas por método | `20261002000002` |
| `business_days`, `cash_registers`, `cash_sessions`, `cash_session_users`, `cash_movements`; `orders`/`payments`/`tab_payments` ganan jornada y caja; settings `default_opening_float` y `cash_count_tolerance` (0); registro «Caja 1» | `20261003000001` |
| `expense_categories`, `expenses` (categoría, método, jornada, caja, `occurred_at`, anulación), `order_items.unit_cost`; `create_expense` / `void_expense`; el efectivo esperado resta gastos en efectivo | `20261004000001` |
