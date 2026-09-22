-- 0006 locale and money: per-user language, whole-peso currency support and wider amounts.
--
--   * profiles.locale ('es' | 'en'): the language of the UI for that user. Every user may change their own
--     (profiles_update already allows it; protect_profile_columns only guards id, email, role and is_active).
--   * money_scale(): decimals of the store currency (settings.currency): 0 for COP and the other whole-unit currencies,
--     2 otherwise. create_sale rounds taxes with it and validates discounts with it. The TypeScript list lives in
--     lib/money.ts (ZERO_DECIMAL_CURRENCIES); a test keeps both in sync.
--   * Money columns become NUMERIC(14,2) (up to 999 999 999 999.99): NUMERIC(10,2) topped out at ~99 999 999, too low for COP.
--     The scale stays 2 in storage: COP amounts are whole numbers, enforced by the API and by create_sale.

-- ---------------------------------------------------------------------------
-- profiles.locale
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column locale text not null default 'es' check (locale in ('es', 'en'));

-- ---------------------------------------------------------------------------
-- currency decimals
-- ---------------------------------------------------------------------------
create or replace function public.currency_decimals(p_currency text)
returns int
language sql immutable parallel safe
set search_path = ''
as $$
  select case
           when upper(p_currency) in ('BIF', 'CLP', 'COP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
                                      'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') then 0
           else 2
         end
$$;

-- Decimals of the store currency. Defaults to COP (0) when settings has no currency yet.
create or replace function public.money_scale()
returns int
language sql stable security definer
set search_path = ''
as $$
  select public.currency_decimals(
    coalesce((select s.value #>> '{}' from public.settings s where s.key = 'currency'), 'COP'))
$$;

revoke all on function public.currency_decimals(text) from public, anon;
revoke all on function public.money_scale() from public, anon;
grant execute on function public.currency_decimals(text) to authenticated;
grant execute on function public.money_scale() to authenticated;

-- ---------------------------------------------------------------------------
-- NUMERIC(14,2) money columns
-- ---------------------------------------------------------------------------
-- A trigger defined on "update of total" blocks the type change of that column: drop it and recreate it afterwards.
drop trigger if exists orders_refresh_customer_totals on public.orders;

alter table public.products
  alter column cost_price type numeric(14, 2),
  alter column selling_price type numeric(14, 2);

alter table public.product_variants
  alter column cost_price type numeric(14, 2),
  alter column selling_price type numeric(14, 2);

alter table public.purchase_orders
  alter column total_amount type numeric(14, 2);

-- total is GENERATED: Postgres cannot change the type of a column a generated column depends on, and cannot turn a plain
-- column back into a generated one, so the generated column is recreated (its values are recomputed).
alter table public.purchase_order_items
  drop column total,
  alter column unit_price type numeric(14, 2),
  add column total numeric(14, 2) generated always as (quantity * unit_price) stored;

alter table public.customers
  alter column total_spent type numeric(14, 2);

alter table public.orders
  alter column subtotal type numeric(14, 2),
  alter column discount type numeric(14, 2),
  alter column tax type numeric(14, 2),
  alter column total type numeric(14, 2);

alter table public.order_items
  alter column unit_price type numeric(14, 2),
  alter column discount type numeric(14, 2),
  alter column tax type numeric(14, 2),
  alter column total type numeric(14, 2);

alter table public.payments
  alter column amount type numeric(14, 2);

alter table public.expenses
  alter column amount type numeric(14, 2);

create trigger orders_refresh_customer_totals
  after insert or update of status, total, customer_id or delete on public.orders
  for each row execute function public.orders_refresh_customer_totals();

-- ---------------------------------------------------------------------------
-- create_sale: same contract as 0004, but taxes are rounded to the currency's decimals (money_scale()) and prices or
-- discounts with more decimals than the currency allows are rejected.
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

revoke all on function public.create_sale(uuid, jsonb, public.payment_method, numeric) from public, anon;
grant execute on function public.create_sale(uuid, jsonb, public.payment_method, numeric) to authenticated;
