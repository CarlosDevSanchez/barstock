# Verificar los datos de una base existente (antes y después de migrar)

> Sustituye a las 7 pruebas manuales del checkout, que verificaban el código **anterior** a la etapa 1 (el stock no se descontaba, el reembolso no era atómico…). Esas hipótesis
> ([C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md), [M14](../04-auditoria/hallazgos/medios-y-bajos.md)) hoy las cubren pruebas automáticas (ver la tabla del final).
> Lo que **sigue haciendo falta** es comprobar una base **con datos reales** antes de aplicarle las migraciones y confirmar el resultado después.
>
> ⚠️ **Solo lectura contra el proyecto real** (regla dura 10 de `AGENTS.md`): ejecutar estas consultas en el SQL Editor, sin `UPDATE`/`DELETE`. Cualquier corrección de datos se prepara y prueba primero en staging.
> Todas las consultas de este documento se ejecutan sin errores contra el esquema resultante de las migraciones.

## A. Antes de migrar: ¿los datos cumplen las reglas nuevas?

Las migraciones añaden `CHECK`, `NOT NULL` e índices únicos que **fallan si hay filas que los incumplen**. Cada consulta debe devolver **0 filas** (o el valor indicado). Si no, hay que depurar esos datos en staging antes de migrar.

```sql
-- 1. Stock negativo  (CHECK inventory.quantity >= 0)
select id, product_id, quantity from public.inventory where quantity < 0;

-- 2. Inventario duplicado para un producto sin variante  (índice único parcial)
select product_id, count(*) from public.inventory
where variant_id is null group by product_id having count(*) > 1;

-- 3. Precios o costos negativos  (CHECK en products y product_variants)
select id, sku, cost_price, selling_price from public.products where cost_price < 0 or selling_price < 0;
select id, sku from public.product_variants where cost_price < 0 or selling_price < 0;

-- 4. Tasa de impuesto fuera de 0..1  (CHECK; una tasa guardada como porcentaje, p. ej. 10, la incumple)
select id, sku, tax_rate from public.products where tax_rate < 0 or tax_rate > 1;

-- 5. Importes negativos o cantidades <= 0 en ventas y pagos
select id, order_number from public.orders where subtotal < 0 or discount < 0 or tax < 0 or total < 0;
select id, order_id from public.order_items where quantity <= 0 or unit_price < 0 or discount < 0 or tax < 0 or total < 0;
select id, order_id from public.payments where amount < 0;

-- 6. Hijos huérfanos o sin dueño  (NOT NULL en las FKs de pertenencia)
select id from public.inventory where product_id is null;
select id from public.order_items where order_id is null or product_id is null;
select id from public.payments where order_id is null;
select id from public.inventory_transactions where inventory_id is null;

-- 7. Tipos de movimiento fuera de la lista  (CHECK)  y cantidades 0
select id, transaction_type, quantity from public.inventory_transactions
where transaction_type not in ('purchase', 'sale', 'adjustment', 'return') or quantity = 0;

-- 8. Perfiles sin rol, o usuarios de Auth sin perfil
select id, email from public.profiles where role is null;
select u.id, u.email from auth.users u left join public.profiles p on p.id = u.id where p.id is null;

-- 9. Al menos un admin activo ANTES de cerrar el registro (si no, nadie podrá gestionar usuarios)
select count(*) as admins from public.profiles where role = 'admin';   -- debe ser >= 1 (si 0: promover a alguien)
```

Para las dos comprobaciones **aritméticas** (`total = subtotal − discount + tax` y `total = unit_price × quantity − discount + tax`) las migraciones usan `NOT VALID`: no bloquean con datos antiguos, pero conviene saber **cuántas** órdenes las incumplen (impuestos calculados en el cliente, [H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md)):

```sql
-- 10. Órdenes cuyo total no cuadra con subtotal - descuento + impuesto
select id, order_number, subtotal, discount, tax, total from public.orders
where total <> subtotal - coalesce(discount, 0) + coalesce(tax, 0);

-- 11. Líneas cuyo total no cuadra con precio x cantidad - descuento + impuesto
select id, order_id, quantity, unit_price, discount, tax, total from public.order_items
where total <> unit_price * quantity - coalesce(discount, 0) + coalesce(tax, 0);

-- 12. Órdenes cuyo total no cuadra con la suma de sus líneas
select o.id, o.order_number, o.total, sum(i.total) as items_total
from public.orders o join public.order_items i on i.order_id = o.id
group by o.id
having abs(o.total - (sum(i.total) - o.discount + o.tax)) > 0.01;
```

Otras comprobaciones útiles antes de migrar:

```sql
-- 13. Productos sin fila de inventario (la migración creará una con cantidad 0: habrá que ajustarla)
select p.sku, p.name from public.products p
left join public.inventory i on i.product_id = p.id and i.variant_id is null
where i.id is null;

-- 14. Órdenes reembolsadas cuyo stock no se repuso (el reembolso antiguo no era atómico)
select o.order_number from public.orders o
where o.status = 'refunded'
  and not exists (select 1 from public.inventory_transactions t where t.reference_id = o.id and t.transaction_type = 'return');

-- 15. Clientes cuyo total_spent manual difiere del derivado de sus órdenes (la migración los SUSTITUYE)
select c.id, c.name, c.total_spent as manual,
       coalesce((select sum(o.total) from public.orders o where o.customer_id = c.id and o.status = 'completed'), 0) as derived
from public.customers c
where c.total_spent <> coalesce((select sum(o.total) from public.orders o where o.customer_id = c.id and o.status = 'completed'), 0);
```

## B. Después de migrar: ¿quedó como debe?

Todas deben devolver lo indicado.

```sql
-- 1. RLS activa en todas las tablas (todas true)
select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by relname;

-- 2. Ninguna política permisiva: 0 filas (nada con `true` como única condición ni con auth.role())
select tablename, policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true' or qual ilike '%auth.role()%' or with_check ilike '%auth.role()%');

-- 3. `anon` no tiene ningún privilegio sobre las tablas: 0 filas
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';

-- 4. `authenticated` no puede escribir ventas ni stock directamente: 0 filas
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public'
  and table_name in ('orders', 'order_items', 'payments', 'inventory', 'inventory_transactions')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- 5. Funciones: `anon` nunca ejecuta; `authenticated` solo las públicas (create_sale, refund_order, adjust_inventory,
--    dashboard_summary, sales_report, has_min_role, current_app_role)
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_sale', 'refund_order', 'adjust_inventory', 'dashboard_summary', 'sales_report',
                    'has_min_role', 'current_app_role', 'refresh_customer_totals', 'handle_new_user')
order by p.proname;

-- 6. Triggers esperados
select event_object_table as tabla, trigger_name from information_schema.triggers
where trigger_schema in ('public', 'auth')
  and trigger_name in ('protect_profile_columns', 'create_inventory_for_product', 'orders_refresh_customer_totals',
                       'on_auth_user_created', 'on_auth_user_app_metadata_role_changed')
group by 1, 2 order by 1, 2;   -- 5 filas

-- 7. Toda la base es consistente: las consultas 13 y 15 de la sección A ahora devuelven 0 filas.

-- 8. Reparto de usuarios (debe haber un admin activo)
select role, is_active, count(*) from public.profiles group by 1, 2 order by 1, 2;

-- 9. Restricciones aún sin validar (las aritméticas de orders y order_items)
select conrelid::regclass as tabla, conname from pg_constraint
where connamespace = 'public'::regnamespace and not convalidated;
```

Tras depurar los datos que devolvieron las consultas 10–12 de la sección A (**primero en staging**), validar el histórico:

```sql
-- alter table public.orders validate constraint orders_total_matches;
-- alter table public.order_items validate constraint order_items_total_matches;
```

Fuera de SQL, en el panel de Supabase: registro público **desactivado**, proveedor de email **activo**, confirmación de email y longitud mínima de contraseña 10, y las **plantillas** de invitación y recuperación
pegadas (`supabase/templates/`). Ver [autenticación](../01-arquitectura/03-autenticacion-y-sesion.md#configuración-relevante-supabaseconfigtoml).

## C. Qué cubre ahora cada hipótesis antigua

| Prueba manual anterior | Ahora |
|---|---|
| 1. ¿Se descuenta el stock? | `sales.test.ts` y `rpc.test.ts` (stock, movimientos `sale`); e2e `sale-and-refund` |
| 2. Integridad tras una venta | `rpc.test.ts` (rollback total, aritmética) y los `CHECK` (`rls.test.ts`) |
| 3. ¿Coinciden los impuestos? (H3) | `create_sale` calcula por producto y por línea; `cart-preview.test.ts` lo compara con el resultado real de la BD |
| 4. Carrera de stock | `rpc.test.ts`: última unidad, ráfaga de 25 ventas, ventas cruzadas sin deadlock |
| 5. Reembolso | `rpc.test.ts` y `sales.test.ts` (idempotente, 30 rondas × 8 simultáneos) |
| 6. Formularios con cadenas vacías (M14) | `resources.test.ts`, `catalog.test.ts` (`''` → `null`) |
| 7. Otros: escalada de rol (C1), "Low Stock" topado en 5, "Loyalty Points" | `rls.test.ts`, `admin.test.ts`, `rpc.test.ts` |

## Registrar resultados
Anotar fecha, entorno, commit y resultado en el hallazgo correspondiente ([`04-auditoria/hallazgos/`](../04-auditoria/hallazgos/)) y no dejar datos de prueba en la base real.
