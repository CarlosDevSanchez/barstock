# RLS, roles y políticas

> **Estado: implementado** en las migraciones `20260921000002`–`…03` (etapa 1, Pasos 3–4). Confianza: **[Verificado]** contra una BD local
> (`supabase db reset`) con usuarios reales de Auth vía PostgREST y con simulación de roles en SQL. El estado **anterior** (políticas
> permisivas de `fix_rls_policies.sql`) está documentado en [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md) y en `supabase/legacy/`.
>
> ⚠️ Las páginas actuales aún llaman a Supabase directamente y **no** están adaptadas a estas políticas (p. ej. el POS inserta en `orders`,
> que ahora está prohibido). Se adaptan en el refactor a API (Paso 5). Hasta entonces la UI no funciona contra esta BD.

## Modelo

- Roles jerárquicos: `admin ≥ manager ≥ cashier`, guardados en `profiles.role`. `has_min_role('manager')` es cierto para gerente y admin.
- `current_app_role()` devuelve el rol **solo si `profiles.is_active`**: un usuario desactivado no tiene rol y **no pasa ninguna política**
  (tampoco la de su propio perfil), ni puede llamar a los RPC.
- Todas las políticas son `TO authenticated`. `anon` no tiene ningún privilegio sobre tablas, secuencias ni funciones
  (`REVOKE` explícito y `ALTER DEFAULT PRIVILEGES`, porque Supabase concede por defecto a `anon` todo lo que se crea en `public`).
- Las políticas evalúan el rol con `(select public.has_min_role(...))` para que se calcule una vez por consulta, no por fila.
- **Las escrituras de ventas y stock no tienen política**: se hacen solo desde RPC `SECURITY DEFINER` ([triggers y funciones](04-triggers-y-funciones.md)).

## Matriz efectiva

| Tabla | Cajero | Gerente | Admin |
|---|---|---|---|
| `profiles` | SELECT propio; UPDATE propio (trigger limita columnas) | SELECT todos | SELECT/UPDATE todos (rol, `is_active`) |
| `categories` | SELECT | + INSERT, UPDATE, DELETE | ídem |
| `products` | SELECT (sin `deleted_at`) | + SELECT borrados, INSERT, UPDATE (borrado lógico) | + DELETE físico |
| `promotions` | SELECT (sin `deleted_at`) | + SELECT borrados, INSERT, UPDATE (borrado lógico); **sin DELETE** (historial en `order_items`) | ídem |
| `promotion_items` | SELECT | + INSERT, UPDATE, DELETE | ídem |
| `product_variants` | SELECT | + INSERT, UPDATE | + DELETE |
| `inventory` | SELECT | SELECT | SELECT (escritura solo vía RPC) |
| `inventory_transactions` | — | SELECT | SELECT (las escribe el RPC) |
| `customers` | SELECT, INSERT, UPDATE (solo `name, email, phone, address, is_active, deleted_at`; `deleted_at` solo admin, trigger `guard_soft_delete`) | ídem | + DELETE; borrado lógico (`deleted_at`) |
| `suppliers`, `purchase_orders`, `purchase_order_items` | — | SELECT, INSERT, UPDATE (en `suppliers`, `deleted_at` solo admin: trigger `guard_soft_delete`) | + DELETE; borrado lógico de `suppliers` (`deleted_at`) |
| `orders` | SELECT **propias** (`created_by`) | SELECT todas | SELECT todas |
| `order_items`, `payments` | SELECT de sus órdenes (heredan la visibilidad de `orders`) | todas | todas |
| `expenses` | — | SELECT (escritura solo vía `create_expense`) | SELECT; anulación vía `void_expense` |
| `expense_categories` | SELECT | SELECT | SELECT, INSERT, UPDATE (sin DELETE) |
| `settings` | SELECT | SELECT | SELECT, INSERT, UPDATE, DELETE |
| `tabs`, `tab_members`, `tab_items`, `tab_payments` | SELECT (compartido: cualquier cajero ve/atiende cualquier cuenta; escritura solo vía RPC) | SELECT | SELECT |
| `audit_log` | — | — | SELECT (append-only: ver abajo) |

`orders`, `order_items`, `payments`, `inventory` e `inventory_transactions` tienen además `REVOKE INSERT, UPDATE, DELETE` a nivel de tabla
(defensa en profundidad: aunque alguien añadiera una política por error, el privilegio no existe). `TRUNCATE`, `REFERENCES` y `TRIGGER`
están revocados para `authenticated` en todas las tablas (`TRUNCATE` ignora RLS). `tabs`, `tab_members`, `tab_items` y `tab_payments`
siguen el mismo patrón: `REVOKE INSERT, UPDATE, DELETE` a `authenticated` (solo hay política de `SELECT`); todo lo demás pasa por las RPC de
[cuentas-abiertas](../03-modulos/cuentas-abiertas.md).

`customers` usa **privilegios por columna**: `total_spent` y `loyalty_points` están derivados de las órdenes y ningún cliente de la API
puede escribirlos.

**Borrado lógico de personas** (migración `20260923000001`): `customers` y `suppliers` tienen `deleted_at`. Como cualquier cajero puede hacer
`UPDATE` de un cliente (y cualquier gerente de un proveedor), la regla "solo admin borra o restaura" no cabe en una política: la impone el
trigger `BEFORE UPDATE` **`guard_soft_delete`** (`42501` si `deleted_at` cambia y el usuario no es admin; `auth.uid()` nulo = migraciones o
`service_role`, se permite). Las políticas de `SELECT` no filtran `deleted_at`: lo hacen los servicios (`.is('deleted_at', null)`), y
`create_sale`/`open_tab` rechazan un cliente borrado.

> **Decisión que difiere del plan:** el plan de pruebas decía "cajero no lee `settings`", pero la matriz objetivo y la tabla de endpoints
> dan `SELECT` a todos (el cajero necesita moneda y nombre de tienda). Se implementó **lectura para todos, escritura solo admin**.

## Protección de `profiles`

Trigger `protect_profile_columns` (`BEFORE UPDATE`), solo cuando hay un usuario en el JWT (`auth.uid()` no nulo):

- `id` y `email` no se pueden cambiar por la API.
- Solo un admin cambia `role` o `is_active`.
- No se puede degradar ni desactivar al **último admin activo**.

Sin usuario en el JWT (SQL Editor, migraciones, `service_role`) no bloquea: el servidor es de confianza.

**Cuidado con lo silencioso:** las políticas de `UPDATE`/`DELETE` que no cumplen **no lanzan error, afectan 0 filas** (el cajero que "borra"
un producto recibe éxito con 0 filas). El resultado de rol insuficiente en `profiles` sí es error (`42501`, lo lanza el trigger) cuando el
usuario ve la fila, y 0 filas cuando no la ve. Los servicios deben comprobar el número de filas afectadas y devolver `404`/`403`.

## `audit_log`: append-only para todos, incluido `service_role`

A diferencia del resto de tablas, aquí la protección **no depende solo de RLS**: `audit_log` solo tiene una política
`SELECT` (admin), y además:

- `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` a `authenticated`/`anon` (privilegios de tabla).
- Triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE` que lanzan `raise exception` **siempre**, sin excepción para
  `auth.uid()` nulo. Esta es la capa que de verdad importa: `service_role` y el editor SQL **bypasean RLS** (tienen
  `BYPASSRLS`/son el propietario), así que sin este trigger podrían editar o borrar el historial libremente. Los
  triggers no distinguen quién ejecuta la sentencia.

Detalle completo en [Auditoría](../03-modulos/auditoria.md) y en el trigger `audit_row_change` /
[04-triggers-y-funciones](04-triggers-y-funciones.md).

## Alta de usuarios: cerrada por defecto

- `enable_signup = false` (`supabase/config.toml`). En un proyecto hospedado hay que desactivarlo en *Authentication → Sign In / Providers*.
  El proveedor de **email debe seguir activo** (`[auth.email] enable_signup = false` desactiva también el login por email).
- `handle_new_user` lee el rol **solo de `raw_app_meta_data`** (solo el servidor puede escribirlo; `user_metadata` lo edita el usuario y no se
  confía). Un perfil nace **activo únicamente si el servidor le asignó rol**; cualquiera que se dé de alta por otra vía (signup abierto)
  obtiene un perfil `cashier` **inactivo**, sin acceso a nada.
- GoTrue inserta el usuario y **después** escribe `app_metadata`, por eso existe también `sync_profile_role_from_app_metadata`
  (`AFTER UPDATE`), que aplica el rol **solo si la clave `role` cambia** (un `UPDATE` ajeno de `app_metadata` no revierte un cambio de rol
  ni reactiva a un usuario). *Verificado con la API real: `auth.admin.createUser({ app_metadata: { role } })` produce un perfil activo con ese rol.*

## Cómo auditar el estado real

```sql
-- Políticas vigentes
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, cmd, policyname;

-- Tablas con RLS activa (todas deben ser true)
select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by relname;

-- Privilegios de anon (debe devolver 0 filas)
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
```

## Pruebas

- Automatizadas: Paso 6 (`test/integration/`, clientes `supabase-js` autenticados como cajero, gerente y admin).
- Simulación manual de un rol en SQL (dentro de una transacción con `rollback`):
  ```sql
  begin;
    select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
    set local role authenticated;
    -- … sentencias a probar …
  rollback;
  ```

## Jornada y cajas (`20261003000001`)

Cajero+ puede leer `business_days`, `cash_registers`, `cash_sessions`, `cash_session_users` y `cash_movements`. No hay políticas de escritura: todo pasa por RPC, salvo `cash_registers` (insert y update solo admin). `anon` no tiene privilegios; `authenticated` no puede borrar ni truncar.

## Migrar una base ya desplegada

`…03_roles_rls.sql` elimina **todas** las políticas existentes (incluidas las de `fix_rls_policies.sql` si se aplicó) y crea las definitivas.
Los perfiles existentes quedan `is_active = true` con su rol actual (todos `cashier`): promover al primer admin **antes** de cerrar el signup
(`update public.profiles set role = 'admin' where email = '…'`; en el SQL Editor `auth.uid()` es nulo y el trigger no bloquea).
