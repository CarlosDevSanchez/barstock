# Diseño objetivo: permisos y funciones transaccionales

> ✅ **Implementado en la etapa 1** (migraciones `supabase/migrations/…03`–`…05`; ver [RLS](../02-base-de-datos/03-rls-y-politicas.md) y
> [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md)). Este documento se conserva como **el borrador de origen**; donde
> difiere, manda la migración (p. ej. `refund_order` ahora es idempotente y guarda `refunded_at/by/reason`, `create_sale` ordena las líneas contra
> deadlocks y comprueba el rol dentro, y `handle_new_user` deja inactivos a los usuarios sin rol asignado por el servidor).
>
> ~~⚠️ Borrador de diseño. NO ejecutado ni probado.~~ (histórico:) El SQL es un punto de partida para revisión y pruebas en **staging**.
> No pegar en producción tal cual. Antes de aplicarlo: ejecutar la baseline de migraciones y las consultas de integridad
> ([plan, Fase 1](plan-de-remediacion.md)). Las reglas fiscales y de negocio marcadas como *decisión pendiente* dependen de
> [decisiones-pendientes](decisiones-pendientes.md).

Cubre: [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md) (permisos) y [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md) (RPC).

## 1. Rol actual y protección de `profiles.role`

```sql
-- Rol del usuario autenticado (nulo si no hay sesión o no hay perfil)
create or replace function public.current_app_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

-- Impide que un usuario cambie su propio rol (o el de otros) salvo admins.
-- Con auth.uid() nulo (SQL Editor / service_role) no bloquea, para poder promover al primer admin.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.role is distinct from old.role
     and coalesce(public.current_app_role(), 'cashier') <> 'admin' then
    raise exception 'only admins can change roles' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_profile_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- Política de actualización propia con WITH CHECK
drop policy if exists "Users can update own profile" on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
```

## 2. Políticas por rol (ejemplos)

Primero **eliminar** las políticas amplias de `fix_rls_policies.sql` y las antiguas del esquema (auditar con la consulta de
[RLS](../02-base-de-datos/03-rls-y-politicas.md)). Ejemplo para tres tablas:

```sql
-- Catálogo: todos leen; gerente/admin escriben
drop policy if exists "Products - SELECT for authenticated" on public.products;
drop policy if exists "Products - INSERT for authenticated" on public.products;
drop policy if exists "Products - UPDATE for authenticated" on public.products;
drop policy if exists "Products - DELETE for authenticated" on public.products;
drop policy if exists "Products are viewable by all authenticated users" on public.products;

create policy products_select on public.products
  for select to authenticated using (true);

create policy products_write on public.products
  for all to authenticated
  using      (public.current_app_role() in ('admin','manager'))
  with check (public.current_app_role() in ('admin','manager'));

-- Ajustes: todos leen; solo admin escribe
create policy settings_select on public.settings
  for select to authenticated using (true);
create policy settings_write on public.settings
  for all to authenticated
  using      (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- Ventas: lectura; SIN políticas de escritura (solo las RPC SECURITY DEFINER escriben)
create policy orders_select on public.orders
  for select to authenticated
  using (created_by = (select auth.uid())
         or public.current_app_role() in ('admin','manager'));

revoke insert, update, delete on public.orders, public.order_items, public.payments,
                                 public.inventory, public.inventory_transactions
  from authenticated;
```

Repetir para el resto de tablas según la [matriz objetivo](../02-base-de-datos/03-rls-y-politicas.md#matriz-efectiva).

## 3. Secuencia de número de orden

```sql
create sequence if not exists public.order_number_seq;
```

## 4. `create_sale` (esqueleto)

Entrada: solo ids y cantidades. Precios, impuestos y totales los calcula la función.

```sql
create or replace function public.create_sale(
  p_customer_id    uuid,
  p_items          jsonb,               -- [{"product_id":"…","variant_id":null,"quantity":2,"discount":0}]
  p_payment_method public.payment_method,
  p_discount       numeric default 0    -- descuento global: decisión pendiente (D3/D6)
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_order_id   uuid;
  v_item       record;
  v_price      numeric(10,2);
  v_tax_rate   numeric;
  v_inv_id     uuid;
  v_line_base  numeric(10,2);
  v_line_tax   numeric(10,2);
  v_subtotal   numeric(10,2) := 0;
  v_tax        numeric(10,2) := 0;
  v_total      numeric(10,2);
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_discount < 0 then raise exception 'invalid discount'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty cart';
  end if;

  insert into public.orders (order_number, customer_id, status, created_by)
  values ('ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
          p_customer_id, 'completed', v_uid)
  returning id into v_order_id;

  for v_item in
    select (e->>'product_id')::uuid                        as product_id,
           nullif(e->>'variant_id', '')::uuid              as variant_id,
           (e->>'quantity')::int                           as quantity,
           coalesce((e->>'discount')::numeric, 0)          as discount
    from jsonb_array_elements(p_items) e
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then raise exception 'invalid quantity'; end if;
    if v_item.discount < 0 then raise exception 'invalid line discount'; end if;

    -- Precio e impuesto desde la BD (nunca del cliente)
    select coalesce(v.selling_price, p.selling_price), p.tax_rate
      into v_price, v_tax_rate
    from public.products p
    left join public.product_variants v on v.id = v_item.variant_id and v.product_id = p.id
    where p.id = v_item.product_id and p.is_active
      and (v_item.variant_id is null or v.id is not null);   -- la variante debe pertenecer al producto
    if not found then raise exception 'product not available: %', v_item.product_id; end if;

    v_line_base := v_price * v_item.quantity - v_item.discount;
    if v_line_base < 0 then raise exception 'discount exceeds line amount'; end if;
    v_line_tax  := round(v_line_base * v_tax_rate, 2);       -- regla fiscal: decisión pendiente (D3)

    -- Descuento de stock atómico: la condición evita stock negativo
    v_inv_id := null;
    update public.inventory
       set quantity = quantity - v_item.quantity
     where product_id = v_item.product_id
       and variant_id is not distinct from v_item.variant_id
       and quantity >= v_item.quantity
    returning id into v_inv_id;
    if v_inv_id is null then
      raise exception 'insufficient stock for product %', v_item.product_id using errcode = 'P0001';
    end if;

    insert into public.order_items (order_id, product_id, variant_id, quantity, unit_price, discount, tax, total)
    values (v_order_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price,
            v_item.discount, v_line_tax, v_line_base + v_line_tax);

    insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, created_by)
    values (v_inv_id, 'sale', -v_item.quantity, v_order_id, v_uid);

    v_subtotal := v_subtotal + v_line_base;
    v_tax      := v_tax + v_line_tax;
  end loop;

  v_total := v_subtotal + v_tax - p_discount;                 -- ubicación del descuento global: decisión pendiente
  if v_total < 0 then raise exception 'discount exceeds total'; end if;

  update public.orders
     set subtotal = v_subtotal, discount = p_discount, tax = v_tax, total = v_total
   where id = v_order_id;

  insert into public.payments (order_id, payment_method, amount)
  values (v_order_id, p_payment_method, v_total);

  return v_order_id;
end;
$$;

revoke all on function public.create_sale(uuid, jsonb, public.payment_method, numeric) from public;
grant execute on function public.create_sale(uuid, jsonb, public.payment_method, numeric) to authenticated;
```

Notas de diseño:
- Toda la función corre en **una transacción**: si algo falla (stock insuficiente, FK, `CHECK`) no queda nada escrito.
- El `UPDATE … WHERE quantity >= n` toma el bloqueo de fila: dos ventas concurrentes del último ítem se serializan y una falla.
- `v_inv_id := null` antes de cada `UPDATE` es necesario: sin filas, `RETURNING … INTO` no asigna y conservaría el valor de la iteración anterior.
- Si un producto **no tiene fila de inventario** la venta falla (`insufficient stock`). Decidir si es lo deseado o si se permite vender sin control de stock ([D9](decisiones-pendientes.md)).

Uso desde el cliente:

```ts
const { data: orderId, error } = await supabase.rpc('create_sale', {
    p_customer_id: selectedCustomer || null,
    p_items: items.map(i => ({
        product_id: i.product.id,
        variant_id: i.variant?.id ?? null,
        quantity: i.quantity,
        discount: i.discount,
    })),
    p_payment_method: paymentMethod,
    p_discount: discount,
})
if (error) throw error
```

## 5. `refund_order` (esqueleto)

```sql
create or replace function public.refund_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_item   record;
  v_inv_id uuid;
begin
  if coalesce(public.current_app_role(), 'cashier') not in ('admin','manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Idempotente: solo reembolsa una orden 'completed'
  update public.orders
     set status = 'refunded',
         notes  = concat_ws(E'\n', notes, 'Refund: ' || coalesce(p_reason, ''))
   where id = p_order_id and status = 'completed';
  if not found then raise exception 'order not refundable' using errcode = 'P0001'; end if;

  for v_item in select product_id, variant_id, quantity from public.order_items where order_id = p_order_id loop
    v_inv_id := null;
    update public.inventory
       set quantity = quantity + v_item.quantity
     where product_id = v_item.product_id
       and variant_id is not distinct from v_item.variant_id
    returning id into v_inv_id;

    if v_inv_id is not null then
      insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, notes, created_by)
      values (v_inv_id, 'return', v_item.quantity, p_order_id, p_reason, v_uid);
    end if;
  end loop;
  -- Pendiente: registrar el reembolso del pago (columna/tabla de reembolsos), refunded_by / refunded_at.
end;
$$;

revoke all on function public.refund_order(uuid, text) from public;
grant execute on function public.refund_order(uuid, text) to authenticated;
```

## 6. `adjust_inventory` (idea)

`adjust_inventory(p_inventory_id uuid, p_delta int, p_reason text)`: solo gerente/admin; `UPDATE … SET quantity = quantity + p_delta
WHERE id = … AND quantity + p_delta >= 0`, e inserción en `inventory_transactions` tipo `adjustment` con motivo obligatorio.

## 7. Pruebas de políticas (por rol)

Sin instalar nada, simulando un usuario en el SQL Editor (dentro de una transacción con `rollback`):

```sql
begin;
  select set_config('request.jwt.claims',
                    '{"sub":"<uuid-de-un-cajero>","role":"authenticated"}', true);
  set local role authenticated;

  -- Debe FALLAR: un cajero no puede cambiar su rol
  update public.profiles set role = 'admin' where id = '<uuid-de-un-cajero>';

  -- Debe FALLAR: escritura directa a orders
  insert into public.orders (order_number, status) values ('X', 'completed');

  -- Debe FALLAR: cajero no puede borrar productos
  delete from public.products where sku = 'ELEC-001';
rollback;
```

Para automatizarlo: **pgTAP** (`supabase test db`) con un archivo por rol y caso, ejecutado en CI contra una base efímera.

## 8. Orden de despliegue seguro

1. Crear funciones, secuencia y triggers (no rompen nada).
2. Desplegar el cliente que usa las RPC.
3. Sustituir políticas amplias por las de rol.
4. **Después** revocar escrituras directas.
5. Ejecutar pruebas por rol y el checklist de aceptación de [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md) y [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md).
