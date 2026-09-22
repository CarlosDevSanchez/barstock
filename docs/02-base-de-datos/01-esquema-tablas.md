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

**`payments`** — `order_id` → `orders` CASCADE NOT NULL, `payment_method` NOT NULL, `amount` (`CHECK ≥ 0`), `reference_number`, `notes`. Una orden nacida de una venta directa tiene un pago; una nacida de una
cuenta ([cuentas-abiertas](../03-modulos/cuentas-abiertas.md)) puede tener varios (uno por cada pago parcial). `orders.tab_id` → `tabs` (NULL en una venta directa).

## Cuentas abiertas (`tabs`)
Ver [cuentas-abiertas](../03-modulos/cuentas-abiertas.md) para el flujo completo. Solo lectura desde la API (`cashier+`); toda escritura pasa por RPC (`0008_tabs.sql`).

**`tabs`** — `tab_number` UNIQUE NOT NULL (`TAB-000123`, secuencia `tab_number_seq`), `label` NOT NULL (`CHECK` no vacío), `customer_id` → `customers` (opcional), `status tab_status NOT NULL default 'open'`,
`discount NUMERIC(14,2) NOT NULL default 0 (CHECK ≥ 0)`, `order_id` → `orders` (se rellena al cerrar), `opened_by`/`closed_by`/`voided_by` → `auth.users`, `void_reason`, `opened_at`/`closed_at`/`voided_at`.
`CHECK`: `closed` exige `order_id`; `voided` exige `void_reason`. Índice parcial en `opened_at` `WHERE status = 'open'`.

**`tab_members`** — `tab_id` → `tabs` CASCADE NOT NULL, `display_name` NOT NULL (`CHECK` no vacío), `customer_id` → `customers` (opcional). Las personas entre las que se divide la cuenta.

**`tab_items`** — `tab_id` → `tabs` CASCADE NOT NULL, `product_id` → `products` NOT NULL, `variant_id` → `product_variants`, `quantity` (`CHECK > 0`), `unit_price`, `tax_rate` (foto del precio al añadir por primera vez),
`added_by` → `auth.users`. `UNIQUE NULLS NOT DISTINCT (tab_id, product_id, variant_id)` (Postgres 17): añadir de nuevo el mismo producto suma cantidad en vez de crear otra fila.

**`tab_payments`** — `tab_id` → `tabs` CASCADE NOT NULL, `member_id` → `tab_members` (opcional: un pago puede no asignarse a nadie en particular), `payment_method` NOT NULL, `amount` (`CHECK > 0`), `created_by` → `auth.users`.

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
| `profiles.locale`; importes → `NUMERIC(14,2)`; `currency_decimals` / `money_scale`; `create_sale` redondea según la moneda | `…06` |
| `top_selling_products` (RPC, `SECURITY DEFINER`): mode de venta de toda la tienda para el POS | `…0007` |
| `tabs`, `tab_members`, `tab_items`, `tab_payments`, `orders.tab_id`, enum `tab_status` y sus RPC | `…0008` |
