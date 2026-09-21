# Triggers y funciones

> Fuente: `supabase/schema.sql:339-392` · Confianza: **[Verificado]** contra el SQL.

## Funciones

### `update_updated_at_column()` (`:340-346`)
`BEFORE UPDATE` genérico: `NEW.updated_at = NOW()`. PL/pgSQL, sin `SET search_path`.

### `public.handle_new_user()` (`:380-387`)
`SECURITY DEFINER`. Inserta en `public.profiles (id, email, full_name)` usando `NEW.id`, `NEW.email` y
`NEW.raw_user_meta_data->>'full_name'`.

Comportamientos a conocer:
- **No lee `role`** de `raw_user_meta_data`: todos los perfiles nacen como `cashier` (default). El
  selector de rol del registro no tiene efecto.
- Si el `INSERT` falla (por ejemplo `email` duplicado en `profiles`), **falla el alta del usuario** en `auth.users`.
- `SECURITY DEFINER` sin `SET search_path = ''`: el linter de seguridad de Supabase lo marca como
  `function_search_path_mutable`. Recomendado fijar `SET search_path = ''` y calificar las tablas.

## Triggers

| Trigger | Tabla | Momento | Función |
|---|---|---|---|
| `update_profiles_updated_at` | `profiles` | BEFORE UPDATE | `update_updated_at_column` |
| `update_categories_updated_at` | `categories` | BEFORE UPDATE | idem |
| `update_products_updated_at` | `products` | BEFORE UPDATE | idem |
| `update_inventory_updated_at` | `inventory` | BEFORE UPDATE | idem |
| `update_suppliers_updated_at` | `suppliers` | BEFORE UPDATE | idem |
| `update_purchase_orders_updated_at` | `purchase_orders` | BEFORE UPDATE | idem |
| `update_customers_updated_at` | `customers` | BEFORE UPDATE | idem |
| `update_orders_updated_at` | `orders` | BEFORE UPDATE | idem |
| `update_expenses_updated_at` | `expenses` | BEFORE UPDATE | idem |
| `update_settings_updated_at` | `settings` | BEFORE UPDATE | idem |
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_user` |

## Lo que NO existe (y el README sugiere que sí)

| Automatismo esperado | Estado |
|---|---|
| Crear fila de `inventory` al crear un producto | **No existe.** No hay trigger ni código de app que lo haga. El README dice "Products automatically get inventory records". |
| Descontar stock al vender | Solo lo intenta el cliente, no la base (y probablemente falla: [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md)) |
| Registrar `inventory_transactions` en cada cambio de `inventory` | No. Solo la venta escribe (y el reembolso no) |
| Actualizar `customers.total_spent` / `loyalty_points` al completar una orden | No |
| Validar `orders.total = subtotal − discount + tax` | No |
| Impedir `inventory.quantity < 0` | No (sin `CHECK` ni trigger) |
| Impedir cambios de `role` por el propio usuario | No |

## Recomendaciones

1. Sustituir la lógica del cliente por funciones RPC transaccionales (`create_sale`, `refund_order`,
   `adjust_inventory`) que llamen a estos automatismos dentro de una sola transacción.
2. Trigger `AFTER INSERT ON products` que cree la fila de inventario (o crearla desde la RPC de alta).
3. Trigger o `CHECK` para proteger `profiles.role`.
4. `SET search_path = ''` en todas las funciones.

Borrador en [`06-roadmap/diseno-objetivo-seguridad.md`](../06-roadmap/diseno-objetivo-seguridad.md).
