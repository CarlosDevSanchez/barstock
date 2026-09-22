# Índices y constraints

> Extraído de `pg_indexes` y `pg_constraint` de la BD local tras las 5 migraciones · Confianza: **[Verificado]**. **Sin `EXPLAIN` real**: no hay una base con datos de producción; el rendimiento con volumen real es **[Por verificar]**.

## Índices (además de las PK)

| Tabla | Índice | Para qué |
|---|---|---|
| `products` | `products_sku_key`, `products_barcode_key` (UNIQUE), `idx_products_category` | Unicidad y filtro por categoría |
| `product_variants` | `…_sku_key`, `…_barcode_key` (UNIQUE), `idx_product_variants_product` | FK |
| `inventory` | **`inventory_product_without_variant_key`** (UNIQUE parcial `WHERE variant_id IS NULL`), `unique_inventory (product_id, variant_id)`, `idx_inventory_product`, `idx_inventory_variant` (parcial) | Un solo inventario por producto sin variante; FKs |
| `inventory_transactions` | `idx_inventory_transactions_inventory_created (inventory_id, created_at)`, `idx_inventory_transactions_reference` | Historial por artículo y búsqueda por orden |
| `orders` | `orders_order_number_key` (UNIQUE), **`idx_orders_status_created_at (status, created_at)`**, **`idx_orders_created_by_created_at (created_by, created_at)`**, `idx_orders_customer`, `idx_orders_created_at` | Reportes (`completed` + rango), órdenes del cajero, historial del cliente |
| `order_items` | `idx_order_items_order`, **`idx_order_items_product`** | FK y "top productos" |
| `payments` | `idx_payments_order` | FK |
| `customers` | `customers_email_key` (UNIQUE) | |
| `profiles` | `profiles_email_key` (UNIQUE) | |
| `settings` | `settings_key_key` (UNIQUE) | |
| `categories` | `idx_categories_parent` | FK |
| `purchase_orders` / `_items` | `purchase_orders_po_number_key`, `idx_po_supplier`, `idx_purchase_order_items_order` | |

Se eliminaron `idx_products_sku` e `idx_products_barcode` (redundantes con los `UNIQUE`).

## Constraints de integridad

| Tabla | `CHECK` |
|---|---|
| `products` | `cost_price ≥ 0`, `selling_price ≥ 0`, `tax_rate BETWEEN 0 AND 1` |
| `product_variants` | precios nulos o `≥ 0` |
| `inventory` | `quantity ≥ 0` (**nunca stock negativo**), `low_stock_threshold ≥ 0` |
| `inventory_transactions` | `transaction_type IN ('purchase','sale','adjustment','return')`, `quantity ≠ 0` |
| `customers` | `loyalty_points ≥ 0`, `total_spent ≥ 0` |
| `orders` | importes `≥ 0`; **`total = subtotal − discount + tax`** (`NOT VALID`) |
| `order_items` | `quantity > 0`, importes `≥ 0`; **`total = unit_price × quantity − discount + tax`** (`NOT VALID`) |
| `payments`, `expenses` | `amount ≥ 0` |
| `purchase_orders` / `_items` | `total_amount ≥ 0`; `quantity > 0`, `unit_price ≥ 0` |

**`NOT VALID`:** las dos comprobaciones aritméticas se crearon así para no bloquear una base con órdenes antiguas (calculadas en el cliente con impuestos inconsistentes, [H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md)).
Se **exigen en toda fila nueva o modificada**; tras depurar los datos, `ALTER TABLE … VALIDATE CONSTRAINT …` las valida también para el histórico. En una base creada desde cero permanecen `NOT VALID` pero sin filas que las incumplan.
Probado: una orden o línea con la aritmética rota es rechazada (`rls.test.ts`).

**`NOT NULL`:** FKs de pertenencia (`inventory.product_id`, `inventory_transactions.inventory_id`, `order_items.order_id/product_id`, `payments.order_id`, `product_variants.product_id`, `purchase_order_items.purchase_order_id/product_id`), `created_at`/`updated_at`, `is_active` y contadores con default.

**Claves foráneas:** `profiles.id → auth.users` **CASCADE**; hijos de propiedad (`product_variants`, `inventory`, `inventory_transactions`, `order_items`, `payments`, `purchase_order_items`) con **CASCADE**; referencias de catálogo/personas (`products.category_id`, `orders.customer_id`, `order_items.product_id`…) **NO ACTION** (protegen el historial).

## Rendimiento: qué se mejoró y qué falta

- Dashboard y reportes ya **agregan en SQL** (1 llamada, antes 9 y 7) apoyándose en `idx_orders_status_created_at`; las búsquedas y la paginación son **en servidor**.
- El checkout es una sola transacción con 2 sentencias por línea (`UPDATE inventory` con bloqueo de fila, `INSERT`s); ventas concurrentes se serializan **por producto**, no globalmente.
- **[Por verificar]** con datos reales: `pg_stat_statements` / *Query Performance* de Supabase; índices sin uso con:

```sql
select relname as tabla, indexrelname as indice, idx_scan
from pg_stat_user_indexes where schemaname = 'public' order by idx_scan asc, relname;
```

- Pendiente si el volumen lo pide: índice `pg_trgm` GIN sobre `products(name)` para `ilike '%…%'`, `orders(customer_id, created_at)` para historiales largos, y `expenses(date)` cuando exista la UI de gastos.
- `inventory?low=true` filtra en memoria (hasta 1000 filas): con miles de artículos convendría una vista o una función.
