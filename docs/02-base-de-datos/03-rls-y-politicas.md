# RLS y políticas de acceso

> Fuentes: `supabase/schema.sql:255-333` y `supabase/fix_rls_policies.sql` · Confianza: análisis del SQL **[Verificado]**; estado real de la base **[Por verificar]** (se asume que el parche se aplicó, como indica el commit `fbf0f65`).

## Idea clave

RLS es **el único control de autorización** del sistema (no hay backend propio). En Postgres las
políticas *permisivas* de una misma tabla y comando se combinan con **OR**: basta que una permita para que
la operación pase. Por eso el parche `fix_rls_policies.sql`, que añade políticas amplias, **anula** las
restricciones por rol del esquema original sin necesidad de borrarlas.

## RLS habilitado

`ENABLE ROW LEVEL SECURITY` en las 15 tablas (`schema.sql:256-270`). El rol `anon` **no tiene ninguna
política** → un visitante sin sesión no puede leer ni escribir (buen punto de partida). Todo acceso
requiere un usuario autenticado.

## Paso 1 — políticas de `schema.sql`

| Tabla | Política | Comando | Condición |
|---|---|---|---|
| `profiles` | Profiles are viewable by authenticated users | SELECT | `auth.role() = 'authenticated'` |
| `profiles` | Users can update own profile | UPDATE | `auth.uid() = id` (**sin `WITH CHECK`, sin límite de columnas**) |
| `products` | Products are viewable by all authenticated users | SELECT | authenticated |
| `products` | Admins and Managers can manage products | ALL | `EXISTS profiles(id=uid, role IN ('admin','manager'))` |
| `orders` | Orders are viewable by authenticated users | SELECT | authenticated |
| `orders` | Authenticated users can create orders | INSERT | authenticated |
| `orders` | Admins and Managers can update orders | UPDATE | rol admin/manager |
| `categories` | Authenticated users can view categories | SELECT | authenticated |
| `inventory` | Authenticated users can view inventory | SELECT | authenticated |
| `customers` | Authenticated users can view customers | SELECT | authenticated |
| `customers` | Authenticated users can manage customers | ALL | authenticated |
| `settings` | Settings viewable by authenticated | SELECT | authenticated |
| `settings` | Only admins can manage settings | ALL | rol admin |

**Sin ninguna política** en este paso (RLS activa ⇒ acceso denegado): `product_variants`,
`inventory_transactions`, `suppliers`, `purchase_orders`, `purchase_order_items`, `order_items`,
`payments`, `expenses`, y escritura en `categories` e `inventory`. Por eso un cajero no podía completar
una venta con el esquema original y se escribió el parche.

## Paso 2 — `fix_rls_policies.sql`

- **Borra solo dos políticas:** `Authenticated users can view categories` y `Admins and Managers can manage products`.
- **Crea** políticas `USING/WITH CHECK (auth.role() = 'authenticated')`:
  - `categories` y `products`: SELECT, INSERT, UPDATE y DELETE por separado.
  - `ALL` para `product_variants`, `inventory`, `inventory_transactions`, `suppliers`, `purchase_orders`,
    `purchase_order_items`, `customers`, `orders`, `order_items`, `payments`, `expenses`, `settings`.
- **No es idempotente:** volver a ejecutarlo falla con "policy already exists" (no hace `DROP POLICY IF EXISTS` de las que crea).
- **No aparece en el README**: quien siga el README ejecuta solo `schema.sql` + `seed.sql` y obtiene
  el comportamiento restrictivo original (ver [readme-vs-realidad](../04-auditoria/readme-vs-realidad.md)).

## Política efectiva (suma de ambas) [Verificado por análisis]

| Tabla | Quién puede | Qué |
|---|---|---|
| `profiles` | cualquier autenticado | **SELECT** de todos los perfiles (emails, roles). **UPDATE** de su propia fila, **incluida la columna `role`** |
| `settings` | cualquier autenticado | SELECT/INSERT/UPDATE/DELETE (la política "solo admins" queda anulada) |
| `orders`, `order_items`, `payments` | cualquier autenticado | Todo, incluido **borrar ventas y pagos** |
| `products`, `categories`, `product_variants` | cualquier autenticado | Todo |
| `inventory`, `inventory_transactions` | cualquier autenticado | Todo: puede fijar stock arbitrario y borrar la bitácora |
| `customers`, `suppliers`, `purchase_orders`, `purchase_order_items`, `expenses` | cualquier autenticado | Todo |

> Nota: `auth.role() = 'authenticated'` también es verdadero para **usuarios anónimos** de Supabase si la
> opción *Anonymous sign-ins* estuviera activa (**[Por verificar]** en el panel). Recomendado desactivarla.

## Consecuencias

1. **Escalada de privilegios trivial:** `supabase.from('profiles').update({ role: 'admin' }).eq('id', <mi id>)`
   desde la consola del navegador.
2. **Cualquiera con una cuenta lo controla todo.** Y como el registro es abierto, "tener una cuenta" es
   gratis. La gravedad exacta depende de si el proyecto Supabase exige confirmar el email.
3. **Los roles de la UI son cosméticos.** Ver [autenticación](../01-arquitectura/03-autenticacion-y-sesion.md).
4. **Integridad financiera sin protección:** insertar órdenes con `total: 0`, editar `payments.amount`,
   borrar órdenes.

## Matriz objetivo (propuesta, no aplicada)

| Recurso | Cajero | Gerente | Admin |
|---|---|---|---|
| `products`, `categories`, `product_variants` | SELECT | SELECT, INSERT, UPDATE (soft delete) | Todo |
| `inventory` | SELECT | SELECT, UPDATE vía RPC de ajuste | Todo |
| `orders`, `order_items`, `payments` | SELECT propias; INSERT **solo vía RPC** | SELECT todas; reembolso vía RPC | Todo lectura; reembolso vía RPC |
| `customers` | SELECT, INSERT, UPDATE | Todo salvo DELETE | Todo |
| `suppliers`, `purchase_orders*` | — | Todo | Todo |
| `expenses` | — | SELECT, INSERT | Todo |
| `settings` | SELECT | SELECT | Todo |
| `profiles` | SELECT propio; UPDATE de campos no sensibles | SELECT | Todo, incluido `role` |
| `inventory_transactions` | — (escribe la RPC) | SELECT | SELECT |

Borrador de SQL en [`06-roadmap/diseno-objetivo-seguridad.md`](../06-roadmap/diseno-objetivo-seguridad.md).

## Cómo auditar el estado real (ejecutar en el SQL Editor de Supabase)

```sql
-- Políticas vigentes
select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- Tablas con RLS activa
select relname, relrowsecurity, relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by relname;
```
