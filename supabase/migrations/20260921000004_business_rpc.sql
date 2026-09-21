-- 0004 business RPCs: transactional sales, refunds and stock adjustments; derived stock rows and customer totals.
--
-- Business assumptions (recorded in docs/06-roadmap/decisiones-pendientes.md):
--   D3: tax per product (products.tax_rate, a fraction), prices exclude tax, tax rounded per line, the global
--       discount is applied AFTER tax.
--   D9: stock never goes negative; selling a product without an inventory row fails.
--   D7: loyalty points = floor(total_spent), derived from completed orders (refunds subtract).
--
-- Error convention: `raise exception` with the default errcode P0001 carries a message meant for the end user
-- (the API passes it through); P0002 = not found; 42501 = not allowed.

-- ---------------------------------------------------------------------------
-- refund bookkeeping
-- ---------------------------------------------------------------------------
alter table public.orders
  add column refunded_at timestamptz,
  add column refunded_by uuid references auth.users (id),
  add column refund_reason text;

create sequence if not exists public.order_number_seq;

-- ---------------------------------------------------------------------------
-- every product has an inventory row
-- ---------------------------------------------------------------------------
create or replace function public.create_inventory_for_product()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.inventory (product_id, variant_id, quantity, low_stock_threshold)
  values (
    new.id,
    null,
    0,
    coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'low_stock_threshold'), 10)
  )
  on conflict (product_id) where variant_id is null do nothing;
  return new;
end;
$$;
revoke all on function public.create_inventory_for_product() from public, anon, authenticated;

drop trigger if exists create_inventory_for_product on public.products;
create trigger create_inventory_for_product
  after insert on public.products
  for each row execute function public.create_inventory_for_product();

-- Backfill: products created before this migration (quantity unknown => 0; an admin adjusts it).
insert into public.inventory (product_id, variant_id, quantity, low_stock_threshold)
select p.id, null, 0, 10
from public.products p
where not exists (select 1 from public.inventory i where i.product_id = p.id and i.variant_id is null);

-- ---------------------------------------------------------------------------
-- customers.total_spent and loyalty_points are derived from completed orders
-- ---------------------------------------------------------------------------
create or replace function public.refresh_customer_totals(p_customer_id uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.customers c
     set total_spent = s.spent,
         loyalty_points = floor(s.spent)::int
    from (
      select coalesce(sum(o.total), 0) as spent
      from public.orders o
      where o.customer_id = p_customer_id and o.status = 'completed'
    ) s
   where c.id = p_customer_id
$$;
revoke all on function public.refresh_customer_totals(uuid) from public, anon, authenticated;

create or replace function public.orders_refresh_customer_totals()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.customer_id is not null then
    perform public.refresh_customer_totals(old.customer_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.customer_id is not null
     and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    perform public.refresh_customer_totals(new.customer_id);
  end if;
  return null;
end;
$$;
revoke all on function public.orders_refresh_customer_totals() from public, anon, authenticated;

drop trigger if exists orders_refresh_customer_totals on public.orders;
create trigger orders_refresh_customer_totals
  after insert or update of status, total, customer_id or delete on public.orders
  for each row execute function public.orders_refresh_customer_totals();

-- Existing manual values (seed / old UI) are replaced by the derived ones.
update public.customers c
   set total_spent = coalesce((select sum(o.total) from public.orders o
                               where o.customer_id = c.id and o.status = 'completed'), 0);
update public.customers set loyalty_points = floor(total_spent)::int;

-- ---------------------------------------------------------------------------
-- create_sale: the client sends ids and quantities; prices, taxes and totals come from the database.
-- One transaction: any failure (stock, FK, CHECK) leaves nothing written.
-- ---------------------------------------------------------------------------
create or replace function public.create_sale(
  p_customer_id    uuid,
  p_items          jsonb,   -- [{"product_id": "...", "variant_id": null, "quantity": 2, "discount": 0}]
  p_payment_method public.payment_method,
  p_discount       numeric default 0
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_discount   numeric := coalesce(p_discount, 0);
  v_order_id   uuid;
  v_item       record;
  v_name       text;
  v_price      numeric(10, 2);
  v_tax_rate   numeric;
  v_inv_id     uuid;
  v_line_base  numeric(10, 2);
  v_line_tax   numeric(10, 2);
  v_subtotal   numeric(10, 2) := 0;
  v_tax        numeric(10, 2) := 0;
  v_total      numeric(10, 2);
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_payment_method is null then
    raise exception 'A payment method is required';
  end if;
  if v_discount < 0 or v_discount <> round(v_discount, 2) then
    raise exception 'Invalid discount';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The cart is empty';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Too many items in one sale';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from public.customers where id = p_customer_id and is_active) then
    raise exception 'Customer not available';
  end if;

  insert into public.orders (order_number, customer_id, status, created_by)
  values ('ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
          p_customer_id, 'completed', v_uid)
  returning id into v_order_id;

  -- Sorted so concurrent sales lock inventory rows in the same order (no deadlocks).
  for v_item in
    select (e ->> 'product_id')::uuid                  as product_id,
           nullif(e ->> 'variant_id', '')::uuid        as variant_id,
           (e ->> 'quantity')::int                     as quantity,
           coalesce((e ->> 'discount')::numeric, 0)    as discount
    from jsonb_array_elements(p_items) e
    order by 1, 2 nulls first
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Invalid quantity';
    end if;
    if v_item.discount < 0 or v_item.discount <> round(v_item.discount, 2) then
      raise exception 'Invalid line discount';
    end if;

    -- Price and tax rate come from the database, never from the client. The variant must belong to the product.
    select p.name, coalesce(v.selling_price, p.selling_price), p.tax_rate
      into v_name, v_price, v_tax_rate
    from public.products p
    left join public.product_variants v on v.id = v_item.variant_id and v.product_id = p.id
    where p.id = v_item.product_id
      and p.is_active
      and p.deleted_at is null
      and (v_item.variant_id is null or v.id is not null);
    if not found then
      raise exception 'Product not available';
    end if;

    v_line_base := v_price * v_item.quantity - v_item.discount;
    if v_line_base < 0 then
      raise exception 'The discount exceeds the amount of "%"', v_name;
    end if;
    v_line_tax := round(v_line_base * v_tax_rate, 2);

    -- Atomic stock decrement: the WHERE clause prevents negative stock, and the row lock serializes concurrent
    -- sales of the last unit (the loser re-evaluates the condition and finds no row).
    v_inv_id := null;
    update public.inventory
       set quantity = quantity - v_item.quantity
     where product_id = v_item.product_id
       and variant_id is not distinct from v_item.variant_id
       and quantity >= v_item.quantity
    returning id into v_inv_id;
    if v_inv_id is null then
      raise exception 'Insufficient stock for "%"', v_name;
    end if;

    insert into public.order_items (order_id, product_id, variant_id, quantity, unit_price, discount, tax, total)
    values (v_order_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price,
            v_item.discount, v_line_tax, v_line_base + v_line_tax);

    insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, created_by)
    values (v_inv_id, 'sale', -v_item.quantity, v_order_id, v_uid);

    v_subtotal := v_subtotal + v_line_base;
    v_tax      := v_tax + v_line_tax;
  end loop;

  v_total := v_subtotal + v_tax - v_discount;
  if v_total < 0 then
    raise exception 'The discount exceeds the order total';
  end if;

  update public.orders
     set subtotal = v_subtotal, discount = v_discount, tax = v_tax, total = v_total
   where id = v_order_id;

  insert into public.payments (order_id, payment_method, amount)
  values (v_order_id, p_payment_method, v_total);

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- refund_order: managers and admins. Idempotent: refunding twice restocks once.
-- ---------------------------------------------------------------------------
create or replace function public.refund_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status public.order_status;
  v_item   record;
  v_inv_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'A reason is required';
  end if;

  -- Row lock: two concurrent refunds of the same order serialize here.
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_status = 'refunded' then
    return;
  end if;
  if v_status <> 'completed' then
    raise exception 'Only completed orders can be refunded';
  end if;

  update public.orders
     set status = 'refunded', refunded_at = now(), refunded_by = v_uid, refund_reason = v_reason
   where id = p_order_id;

  for v_item in
    select product_id, variant_id, quantity
    from public.order_items
    where order_id = p_order_id
    order by product_id, variant_id nulls first
  loop
    v_inv_id := null;
    update public.inventory
       set quantity = quantity + v_item.quantity
     where product_id = v_item.product_id
       and variant_id is not distinct from v_item.variant_id
    returning id into v_inv_id;

    if v_inv_id is not null then
      insert into public.inventory_transactions
        (inventory_id, transaction_type, quantity, reference_id, notes, created_by)
      values (v_inv_id, 'return', v_item.quantity, p_order_id, v_reason, v_uid);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- adjust_inventory: managers and admins, with a mandatory reason. Returns the new quantity.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_inventory(p_inventory_id uuid, p_delta int, p_reason text)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_reason   text := nullif(btrim(p_reason), '');
  v_quantity int;
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'The adjustment must not be zero';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'A reason is required';
  end if;

  update public.inventory
     set quantity = quantity + p_delta,
         last_restocked_at = case when p_delta > 0 then now() else last_restocked_at end
   where id = p_inventory_id
     and quantity + p_delta >= 0
  returning quantity into v_quantity;

  if v_quantity is null then
    if not exists (select 1 from public.inventory where id = p_inventory_id) then
      raise exception 'Inventory item not found' using errcode = 'P0002';
    end if;
    raise exception 'The adjustment would make the stock negative';
  end if;

  insert into public.inventory_transactions (inventory_id, transaction_type, quantity, notes, created_by)
  values (p_inventory_id, 'adjustment', p_delta, v_reason, v_uid);

  return v_quantity;
end;
$$;

-- Supabase grants EXECUTE to anon by default: only signed-in users may call the RPCs (each re-checks its role).
revoke all on function public.create_sale(uuid, jsonb, public.payment_method, numeric) from public, anon;
revoke all on function public.refund_order(uuid, text) from public, anon;
revoke all on function public.adjust_inventory(uuid, int, text) from public, anon;
grant execute on function public.create_sale(uuid, jsonb, public.payment_method, numeric) to authenticated;
grant execute on function public.refund_order(uuid, text) to authenticated;
grant execute on function public.adjust_inventory(uuid, int, text) to authenticated;
