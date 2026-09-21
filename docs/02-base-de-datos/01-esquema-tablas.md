# Esquema de tablas

> Fuente: `supabase/schema.sql` (392 líneas) · Base: commit `54962b9` · Confianza: **[Verificado]** contra el archivo SQL; **[Por verificar]** contra la base desplegada (no se tuvo acceso).
>
> **Cambios de la etapa 1 (migraciones `…02`–`…04`), posteriores al commit `54962b9`:** este documento describe la **baseline**; encima se aplicó:
> `products.tax_rate` `NUMERIC(6,4)` (fracción 0–1) y `NOT NULL`; `products.deleted_at` (borrado lógico); `profiles.is_active`;
> `orders.refunded_at/refunded_by/refund_reason`; `created_at`/`updated_at` y las FKs de pertenencia `NOT NULL`; `CHECK` en cantidades,
> precios e importes; `profiles.id ON DELETE CASCADE`. Detalle en [seed y migraciones](06-seed-y-migraciones.md).
> Extensión: `uuid-ossp` (los ids usan `uuid_generate_v4()`). Esquema: `public`.

## Enums

| Tipo | Valores | Uso |
|---|---|---|
| `user_role` | `admin`, `manager`, `cashier` | `profiles.role` |
| `payment_method` | `cash`, `card`, `ewallet` | `payments.payment_method` |
| `order_status` | `draft`, `pending`, `completed`, `refunded` | `orders.status` |
| `po_status` | `draft`, `pending`, `received`, `cancelled` | `purchase_orders.status` |

## Usuarios

### `profiles` (`schema.sql:18-27`)
Extiende `auth.users`.

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | UUID | PK, FK → `auth.users(id)` (sin `ON DELETE`) |
| `email` | TEXT | `UNIQUE NOT NULL` |
| `full_name` | TEXT | |
| `role` | `user_role` | default `'cashier'` |
| `avatar_url`, `phone` | TEXT | |
| `created_at`, `updated_at` | TIMESTAMPTZ | default `NOW()` |

## Catálogo

### `categories` (`:34-41`)
`id` PK, `name` NOT NULL, `description`, `parent_id` → `categories(id)` (jerarquía, sin UI), `created_at`, `updated_at`.

### `products` (`:44-58`)
| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | |
| `sku` | TEXT | `UNIQUE NOT NULL` |
| `barcode` | TEXT | `UNIQUE` |
| `category_id` | UUID | FK → `categories(id)` |
| `cost_price` | DECIMAL(10,2) | NOT NULL default 0 |
| `selling_price` | DECIMAL(10,2) | NOT NULL default 0 |
| `tax_rate` | **DECIMAL(5,2)** | default 0 — solo 2 decimales: `0.075` se guarda como `0.08` |
| `image_url` | TEXT | sin uso en UI |
| `is_active` | BOOLEAN | default `true` |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `product_variants` (`:61-71`)
`id` PK, `product_id` → `products` **ON DELETE CASCADE (nullable)**, `name`, `variant_type` (TEXT libre: "size", "color"),
`sku` `UNIQUE NOT NULL`, `barcode` `UNIQUE`, `cost_price`, `selling_price` (ambos nullables: fallback al producto), `created_at`. Sin `updated_at`.

## Inventario

### `inventory` (`:74-85`)
| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | UUID | PK |
| `product_id` | UUID | FK → `products` CASCADE, **nullable** |
| `variant_id` | UUID | FK → `product_variants` CASCADE, nullable (NULL = producto sin variante) |
| `quantity` | INTEGER | NOT NULL default 0, **sin CHECK ≥ 0** |
| `low_stock_threshold` | INTEGER | default 10 |
| `location`, `last_restocked_at` | TEXT, TIMESTAMPTZ | sin uso en UI |
| `created_at`, `updated_at` | TIMESTAMPTZ | |
| — | `CONSTRAINT unique_inventory UNIQUE(product_id, variant_id)` | **No impide duplicados cuando `variant_id` es NULL** (en Postgres los NULL son distintos) |

### `inventory_transactions` (`:88-97`)
Bitácora de movimientos: `id`, `inventory_id` → `inventory` CASCADE, `transaction_type` TEXT (`purchase|sale|adjustment|return`, **sin CHECK ni enum**),
`quantity` INTEGER (negativo = salida), `reference_id` UUID (orden o PO, sin FK), `notes`, `created_by` → `auth.users`, `created_at`.
Solo la venta escribe aquí; el reembolso no.

## Compras

### `suppliers` (`:104-115`)
`id`, `name` NOT NULL, `contact_person`, `email`, `phone`, `address`, `notes`, `is_active` default true, timestamps.

### `purchase_orders` (`:118-131`)
`id`, `po_number` `UNIQUE NOT NULL`, `supplier_id` → `suppliers`, `status po_status` default `draft`, `total_amount` DECIMAL(10,2),
`notes`, `ordered_by`/`received_by` → `auth.users`, `ordered_at`, `received_at`, timestamps.

### `purchase_order_items` (`:134-143`)
`id`, `purchase_order_id` → `purchase_orders` CASCADE, `product_id`, `variant_id`, `quantity` NOT NULL, `unit_price` NOT NULL,
`total` **`GENERATED ALWAYS AS (quantity * unit_price) STORED`** (única tabla con total derivado), `created_at`.

## Clientes

### `customers` (`:150-161`)
`id`, `name` NOT NULL, `email` `UNIQUE`, `phone`, `address`, `loyalty_points` INTEGER default 0, `total_spent` DECIMAL(10,2) default 0,
`is_active` default true, timestamps. **Nada en la app actualiza `loyalty_points` ni `total_spent`**; solo el seed les da valor.

## Ventas

### `orders` (`:168-181`)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `order_number` | TEXT | `UNIQUE NOT NULL`; la app usa `ORD-${Date.now()}` |
| `customer_id` | UUID | FK → `customers`, NULL = mostrador |
| `status` | `order_status` | default `pending`; el POS inserta `completed` directamente |
| `subtotal`, `total` | DECIMAL(10,2) | NOT NULL default 0 |
| `discount`, `tax` | DECIMAL(10,2) | default 0 |
| `notes` | TEXT | sin uso |
| `created_by` | UUID | FK → `auth.users` (no a `profiles`) |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Los importes **los calcula y envía el cliente**; no hay `CHECK` ni trigger que valide `total = subtotal − discount + tax`.

### `order_items` (`:184-195`)
`id`, `order_id` → `orders` CASCADE (nullable), `product_id`, `variant_id` (FK sin cascade), `quantity` NOT NULL, `unit_price` NOT NULL,
`discount`, `tax` default 0, `total` NOT NULL (**no derivado**), `created_at`. Sin snapshot del nombre/SKU: si el producto cambia, el historial cambia.

### `payments` (`:198-206`)
`id`, `order_id` → `orders` CASCADE, `payment_method`, `amount` NOT NULL, `reference_number`, `notes`, `created_at`. Un solo pago por orden en la práctica (no hay pagos mixtos ni cambio).

## Operación

### `expenses` (`:213-222`)
`id`, `category` TEXT (`rent|utilities|salaries|other`, sin enum), `description`, `amount`, `date` DATE, `created_by`, timestamps. **Sin UI.**

### `settings` (`:229-235`)
`id`, `key` `UNIQUE NOT NULL`, `value` JSONB NOT NULL, timestamps. Sembrada con 8 claves; **nadie la lee ni la escribe**.

## Cobertura de campos de auditoría

| Campo | Presente en | Ausente en |
|---|---|---|
| `created_at` | las 15 tablas | — |
| `updated_at` (+ trigger) | profiles, categories, products, inventory, suppliers, purchase_orders, customers, orders, expenses, settings | product_variants, order_items, payments, purchase_order_items, inventory_transactions (inmutable, aceptable) |
| `created_by` | orders, inventory_transactions, expenses | products, customers, categories… (no se sabe quién cambió un precio) |
| `deleted_at` / soft delete | ninguna tabla | Todas; la app borra en duro `products` y `categories` |
| Bitácora de cambios | ninguna | No hay historial de cambios de precio ni de rol |

## Observaciones de normalización

- 3FN en general correcta; los totales de `orders` y `order_items` son **derivados almacenados** (aceptable
  para históricos si se fijan en el servidor, ver [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md)).
- `customers.total_spent` es un agregado desnormalizado sin mecanismo que lo mantenga.
- Muchas FKs de pertenencia son **nullable** cuando deberían ser `NOT NULL` (`inventory.product_id`,
  `order_items.order_id`, `payments.order_id`, `product_variants.product_id`, `purchase_order_items.purchase_order_id`).
