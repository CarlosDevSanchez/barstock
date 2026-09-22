-- 0009 soft delete for people: customers and suppliers get the same soft-delete shape products already have
-- (deleted_at, kept for order/purchase history), but the "who may delete" check has to live in a trigger instead of
-- a DELETE policy: unlike products (where only a manager+ can UPDATE at all), any cashier can UPDATE a customer row
-- and any manager can UPDATE a supplier row, so the column itself needs guarding.
--
-- Error convention (same as 0003's protect_profile_columns): 42501 = not allowed.

-- ---------------------------------------------------------------------------
-- columns + partial indexes (mirrors products.deleted_at; the index matches how the services list rows: newest
-- first, excluding soft-deleted ones)
-- ---------------------------------------------------------------------------
alter table public.customers add column deleted_at timestamptz;
alter table public.suppliers add column deleted_at timestamptz;

create index customers_not_deleted_idx on public.customers (created_at desc) where deleted_at is null;
create index suppliers_not_deleted_idx on public.suppliers (created_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- guard_soft_delete: only admins may set/clear deleted_at. Reused on both tables (one function, one trigger name
-- per table). Modeled on protect_profile_columns (0003): SECURITY DEFINER so it can call has_min_role regardless of
-- the caller's own RLS, and a null auth.uid() (service_role / migrations / SQL editor) is trusted unconditionally.
-- ---------------------------------------------------------------------------
create or replace function public.guard_soft_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.deleted_at is distinct from old.deleted_at and not public.has_min_role('admin') then
    raise exception 'only admins can delete or restore this record' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function public.guard_soft_delete() from public, anon, authenticated;

drop trigger if exists guard_soft_delete on public.customers;
create trigger guard_soft_delete
  before update on public.customers
  for each row execute function public.guard_soft_delete();

drop trigger if exists guard_soft_delete on public.suppliers;
create trigger guard_soft_delete
  before update on public.suppliers
  for each row execute function public.guard_soft_delete();

-- ---------------------------------------------------------------------------
-- grants: customers restricts writes to a column list (0003) and deleted_at was not in it; suppliers has no
-- column-level grant at all (full table UPDATE was already granted to authenticated in 0003/baseline), so a new
-- column there is writable with no extra grant — only customers needs one.
-- ---------------------------------------------------------------------------
grant update (deleted_at) on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- create_sale (last redefined in 0006) and open_tab (0008) must reject a soft-deleted customer_id, the same way
-- they already reject an inactive one. `create or replace` keeps the existing grants.
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
  v_scale      int := public.money_scale();
  v_discount   numeric := coalesce(p_discount, 0);
  v_order_id   uuid;
  v_item       record;
  v_name       text;
  v_price      numeric(14, 2);
  v_tax_rate   numeric;
  v_inv_id     uuid;
  v_line_base  numeric(14, 2);
  v_line_tax   numeric(14, 2);
  v_subtotal   numeric(14, 2) := 0;
  v_tax        numeric(14, 2) := 0;
  v_total      numeric(14, 2);
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_payment_method is null then
    raise exception 'A payment method is required';
  end if;
  if v_discount < 0 or v_discount <> round(v_discount, v_scale) then
    raise exception 'Invalid discount';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The cart is empty';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Too many items in one sale';
  end if;
  if p_customer_id is not null
     and not exists (
       select 1 from public.customers where id = p_customer_id and is_active and deleted_at is null
     ) then
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
    if v_item.discount < 0 or v_item.discount <> round(v_item.discount, v_scale) then
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

    -- A price with more decimals than the store currency allows would make the till preview and the charge disagree.
    if v_price <> round(v_price, v_scale) then
      raise exception 'The price of "%" has more decimals than the store currency allows', v_name;
    end if;

    v_line_base := v_price * v_item.quantity - v_item.discount;
    if v_line_base < 0 then
      raise exception 'The discount exceeds the amount of "%"', v_name;
    end if;
    v_line_tax := round(v_line_base * v_tax_rate, v_scale);

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

create or replace function public.open_tab(p_label text, p_customer_id uuid, p_members text[])
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_label  text := nullif(btrim(p_label), '');
  v_tab_id uuid;
  v_name   text;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_label is null then
    raise exception 'A label is required';
  end if;
  if length(v_label) > 120 then
    raise exception 'The label is too long';
  end if;
  if p_customer_id is not null
     and not exists (
       select 1 from public.customers where id = p_customer_id and is_active and deleted_at is null
     ) then
    raise exception 'Customer not available';
  end if;
  if p_members is not null and array_length(p_members, 1) > 50 then
    raise exception 'Too many people on one tab';
  end if;

  insert into public.tabs (tab_number, label, customer_id, opened_by)
  values ('TAB-' || lpad(nextval('public.tab_number_seq')::text, 6, '0'), v_label, p_customer_id, v_uid)
  returning id into v_tab_id;

  if p_members is not null then
    foreach v_name in array p_members loop
      v_name := nullif(btrim(v_name), '');
      if v_name is not null then
        insert into public.tab_members (tab_id, display_name) values (v_tab_id, v_name);
      end if;
    end loop;
  end if;

  return v_tab_id;
end;
$$;
