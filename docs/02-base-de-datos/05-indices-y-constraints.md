# Índices y constraints

> Fuente: `supabase/schema.sql:241-249` y definiciones de tabla · Confianza: **[Verificado]** contra el SQL. Sin `EXPLAIN` real (no hay acceso a la base).

## Índices explícitos (9)

| Índice | Tabla(columna) | Comentario |
|---|---|---|
| `idx_products_category` | `products(category_id)` | Útil |
| `idx_products_sku` | `products(sku)` | **Redundante**: `UNIQUE` ya crea un índice |
| `idx_products_barcode` | `products(barcode)` | **Redundante**: idem |
| `idx_inventory_product` | `inventory(product_id)` | **Redundante** con el índice de `UNIQUE(product_id, variant_id)` (prefijo `product_id`) |
| `idx_orders_customer` | `orders(customer_id)` | Útil |
| `idx_orders_created_at` | `orders(created_at)` | Útil (dashboard y reportes filtran por fecha) |
| `idx_order_items_order` | `order_items(order_id)` | Útil |
| `idx_payments_order` | `payments(order_id)` | Útil |
| `idx_po_supplier` | `purchase_orders(supplier_id)` | Útil |

## Índices implícitos (por `UNIQUE`/`PK`)

`profiles.email`, `products.sku`, `products.barcode`, `product_variants.sku`, `product_variants.barcode`,
`inventory(product_id, variant_id)`, `purchase_orders.po_number`, `orders.order_number`, `customers.email`,
`settings.key` y todas las PK.

## Índices faltantes recomendados

| Índice propuesto | Motivo |
|---|---|
| `orders(status, created_at)` (compuesto) | El dashboard y los reportes filtran `status='completed'` **y** rango de fechas |
| `order_items(product_id)` | "Top productos" agrupa por producto; además acelera el chequeo de FK al borrar productos |
| `inventory(variant_id)` | FK sin índice |
| `inventory_transactions(inventory_id)` y `(reference_id)` | FK y búsqueda por orden |
| `orders(created_by)` | FK y reportes por cajero |
| `purchase_order_items(purchase_order_id)` | FK sin índice |
| `expenses(date)` | Cuando exista la UI de gastos |
| Índice **parcial único** `inventory(product_id) WHERE variant_id IS NULL` | Corrige los duplicados por `NULL` (alternativa: `UNIQUE NULLS NOT DISTINCT` en PG 15+) |
| `products(is_active)` parcial | El POS consulta `is_active = true` |
| `pg_trgm` GIN sobre `products(name)` | Solo si se pasa la búsqueda al servidor (`ilike`) |

## Constraints faltantes recomendados

| Tabla.columna | Constraint | Por qué |
|---|---|---|
| `inventory.quantity` | `CHECK (quantity >= 0)` | Hoy puede quedar negativo (no hay control de stock) |
| `inventory.low_stock_threshold` | `CHECK (>= 0)` | |
| `products.cost_price / selling_price` | `CHECK (>= 0)` | |
| `products.tax_rate` | Cambiar a `NUMERIC(6,4)` + `CHECK (BETWEEN 0 AND 1)` | `NUMERIC(5,2)` no guarda 7,5 % como `0.075` |
| `orders.subtotal / discount / tax / total` | `CHECK (>= 0)` y `CHECK (total = subtotal - discount + tax)` | Hoy el cliente puede enviar cualquier valor |
| `order_items.quantity` | `CHECK (> 0)` | El carrito permite cantidad 0 |
| `order_items.total` | Columna derivada o `CHECK` | Solo `purchase_order_items.total` es `GENERATED` |
| `payments.amount` | `CHECK (> 0)` | |
| `inventory_transactions.transaction_type` | `CHECK IN (...)` o enum | Hoy es TEXT libre |
| `expenses.category` | enum o `CHECK` | TEXT libre |
| FKs de pertenencia | `NOT NULL` en `inventory.product_id`, `order_items.order_id`, `payments.order_id`, `product_variants.product_id`, `purchase_order_items.purchase_order_id` | Evita filas huérfanas |
| `profiles.id` → `auth.users` | `ON DELETE CASCADE` | Permite dar de baja usuarios |

## Rendimiento: lo observable sin base real

- Las queries del dashboard/reportes hacen `select total from orders where created_at >= … and status = 'completed'`
  hasta 9 veces por carga del dashboard (2 sumas + 7 días) y 7 en reportes. Con el índice compuesto
  propuesto y una vista/RPC agregada, se reduce a 1–2 consultas.
- La búsqueda en `/products`, `/orders`, `/inventory`, `/customers` es **en memoria** tras descargar la tabla
  completa: no usa índices y no escala.
- No se puede evaluar N+1 clásico (no hay ORM), pero sí **N consultas por bucle**: el checkout hace 1–3
  consultas por ítem del carrito y el reembolso 1–2.
- **[Por verificar]** en Supabase: `Reports → Query Performance` y `pg_stat_statements` para consultas lentas
  reales; `pg_stat_user_indexes` para índices sin uso.

```sql
-- Índices sin uso (ejecutar tras algunas semanas de tráfico real)
select relname as tabla, indexrelname as indice, idx_scan
from pg_stat_user_indexes
where schemaname = 'public'
order by idx_scan asc, relname;
```
