# Esquema de tablas

> Esquema **efectivo** tras las 5 migraciones de `supabase/migrations/` (extraído de la BD local con `information_schema`, `pg_constraint` y `pg_indexes`). Confianza: **[Verificado]**.
> El esquema original (`supabase/legacy/schema.sql`) es la migración *baseline*; las diferencias con él están al final. Los tipos de TypeScript se **generan** de este esquema (`bun run db:types`).

Convenciones: PK `id uuid default uuid_generate_v4()`; todas las tablas tienen RLS ([políticas](03-rls-y-politicas.md)); `created_at`/`updated_at timestamptz NOT NULL default now()` (con trigger de `updated_at`).
Los importes son `NUMERIC(10,2)`. Ningún cliente de la API escribe directamente `orders`, `order_items`, `payments`, `inventory` ni `inventory_transactions` (solo RPC).

## Tipos enumerados
| Enum | Valores |
|---|---|
| `user_role` | `admin`, `manager`, `cashier` |
| `payment_method` | `cash`, `card`, `ewallet` |
| `order_status` | `draft`, `pending`, `completed`, `refunded` (**la aplicación solo produce `completed` y `refunded`**) |
| `po_status` | `draft`, `pending`, `received`, `cancelled` (sin uso: compras sin UI) |

## Usuarios
**`profiles`** — `id` → `auth.users` (**ON DELETE CASCADE**), `email` UNIQUE NOT NULL, `full_name`, `role user_role NOT NULL default 'cashier'`, `avatar_url`, `phone`, **`is_active` NOT NULL default true**.
Lo crea un trigger al nacer el usuario; el rol solo lo cambia un admin (trigger); `id` y `email` son inmutables por la API. Ver [RLS](03-rls-y-politicas.md#alta-de-usuarios-cerrada-por-defecto).

## Catálogo
**`categories`** — `name` NOT NULL, `description`, `parent_id` → `categories` (jerarquía; sin UI).

**`products`** — `name` NOT NULL, `description`, `sku` UNIQUE NOT NULL, `barcode` UNIQUE, `category_id` → `categories`, `cost_price` y `selling_price` NOT NULL default 0 (`CHECK ≥ 0`),
**`tax_rate` `NUMERIC(6,4)` NOT NULL default 0 (`CHECK 0–1`, fracción)**, `image_url`, `is_active` NOT NULL default true, **`deleted_at`** (borrado lógico). Un trigger crea su fila de `inventory`.

**`product_variants`** — `product_id` → `products` CASCADE NOT NULL, `name`, `variant_type` (texto libre: "size", "color"), `sku` UNIQUE, `barcode` UNIQUE, `cost_price`, `selling_price` (nullables, `CHECK ≥ 0`). Sin UI ni venta desde el POS (D10).

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

**`order_items`** — `order_id` → `orders` CASCADE NOT NULL, `product_id` → `products` NOT NULL, `variant_id`, `quantity` (`CHECK > 0`), `unit_price`, `discount`, `tax`, `total`. `CHECK` importes ≥ 0 y **`total = unit_price × quantity − discount + tax`** (`NOT VALID`). Guarda el **precio con el que se vendió**.

**`payments`** — `order_id` → `orders` CASCADE NOT NULL, `payment_method` NOT NULL, `amount` (`CHECK ≥ 0`), `reference_number`, `notes`. Hoy: un pago por el total de la orden.

## Compras y gastos (solo esquema; sin API ni UI)
**`purchase_orders`** (`po_number` UNIQUE, `supplier_id`, `status`, `total_amount ≥ 0`, `ordered_by`/`received_by`, fechas) · **`purchase_order_items`** (`purchase_order_id`, `product_id` NOT NULL, `variant_id`, `quantity > 0`, `unit_price ≥ 0`, `total` **GENERATED** `quantity × unit_price`) · **`expenses`** (`category` texto libre, `description`, `amount ≥ 0`, `date`, `created_by`).

## Configuración
**`settings`** — `key` UNIQUE NOT NULL, `value jsonb NOT NULL`. Una fila por clave (`store_name`, `currency`, `timezone`, `tax_rate`, `low_stock_threshold`, `receipt_template`…). Ver [Ajustes](../03-modulos/ajustes.md).

## Diferencias respecto a la baseline
| Cambio | Migración |
|---|---|
| `profiles.is_active`, `products.deleted_at`, `orders.refunded_*` | `…02`, `…04` |
| `products.tax_rate` `DECIMAL(5,2)` → `NUMERIC(6,4)` NOT NULL con `CHECK 0–1` | `…02` |
| `CHECK` de cantidades, precios e importes; aritmética de órdenes y líneas; tipos de movimiento | `…02` |
| `NOT NULL` en FKs de pertenencia (`inventory.product_id`, `order_items.order_id/product_id`, `payments.order_id`, `product_variants.product_id`, `purchase_order_items.*`) y en `created_at`/`updated_at`/booleanos con default | `…02` |
| Índice único parcial de inventario sin variante; `profiles.id ON DELETE CASCADE` | `…02` |
| Secuencia de órdenes; triggers de inventario y totales de clientes | `…04` |
