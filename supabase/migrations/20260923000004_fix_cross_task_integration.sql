-- 0012 cross-task integration fixes: order_items.tax_rate is the rate that was actually charged.
--
-- 0010 (receipt) added order_items.tax_rate, filled by a BEFORE INSERT trigger from the product's *current* rate
-- whenever the caller does not supply one. That is wrong for an order closed from an open tab: the tab's tax was
-- computed with tab_items.tax_rate, the rate frozen when the product was first added (possibly hours earlier). If a
-- manager changed products.tax_rate in between, the ticket printed a rate that does not match the charged tax.
-- Money amounts were always right; only the informational rate was wrong.
--
-- Fix: both writers now pass the rate they actually used, explicitly. The trigger (`if new.tax_rate is null ...`)
-- never overrides a supplied value, so it stays as a fallback and is not touched here. `create or replace` keeps
-- the existing grants/revokes of both functions.

-- ---------------------------------------------------------------------------
-- _close_tab (0008): identical except the order_items insert now carries ti.tax_rate.
-- ---------------------------------------------------------------------------
create or replace function public._close_tab(p_tab_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_scale    int := public.money_scale();
  v_tab      record;
  v_totals   record;
  v_order_id uuid;
begin
  select * into v_tab from public.tabs where id = p_tab_id;
  select * into v_totals from public._tab_totals(p_tab_id);

  insert into public.orders (order_number, customer_id, status, tab_id, created_by, subtotal, discount, tax, total)
  values (
    'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
    v_tab.customer_id, 'completed', p_tab_id, v_uid,
    v_totals.subtotal, v_totals.discount, v_totals.tax, v_totals.total
  )
  returning id into v_order_id;

  -- Stock was already decremented when each item was added: this only copies the lines, it never touches inventory.
  -- tax_rate is the tab line's frozen rate (the one _tab_totals used), not the product's current one.
  insert into public.order_items (order_id, product_id, variant_id, quantity, unit_price, discount, tax, total, tax_rate)
  select
    v_order_id, ti.product_id, ti.variant_id, ti.quantity, ti.unit_price, 0,
    round(ti.unit_price * ti.quantity * ti.tax_rate, v_scale),
    round(ti.unit_price * ti.quantity, v_scale) + round(ti.unit_price * ti.quantity * ti.tax_rate, v_scale),
    ti.tax_rate
  from public.tab_items ti
  where ti.tab_id = p_tab_id;

  insert into public.payments (order_id, payment_method, amount)
  select v_order_id, tp.payment_method, tp.amount from public.tab_payments tp where tp.tab_id = p_tab_id;

  update public.tabs
     set status = 'closed', order_id = v_order_id, closed_by = v_uid, closed_at = now(), updated_at = now()
   where id = p_tab_id;

  return v_order_id;
end;
$$;
revoke all on function public._close_tab(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_sale (last redefined in 0009): identical except the order_items insert now carries v_tax_rate, the rate
-- read under the same statement that priced the line. Relying on the trigger re-read the product in a later
-- statement, so a concurrent tax_rate change committed in between could have been recorded instead.
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

    insert into public.order_items (order_id, product_id, variant_id, quantity, unit_price, discount, tax, total,
                                    tax_rate)
    values (v_order_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price,
            v_item.discount, v_line_tax, v_line_base + v_line_tax, v_tax_rate);

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
-- Backfill: orders closed from a tab. tab_items survive the close (a closed tab is immutable and tab_remove_item
-- only works on open tabs), and (tab_id, product_id, variant_id) is unique, so each order line maps to exactly one
-- tab line whose tax_rate is the rate that was charged. Sales from create_sale need no backfill: until now the
-- trigger read the same product row create_sale had just read in the same transaction.
-- ---------------------------------------------------------------------------
update public.order_items oi
   set tax_rate = ti.tax_rate
  from public.orders o
  join public.tab_items ti on ti.tab_id = o.tab_id
 where oi.order_id = o.id
   and o.tab_id is not null
   and ti.product_id = oi.product_id
   and ti.variant_id is not distinct from oi.variant_id
   and oi.tax_rate is distinct from ti.tax_rate;
