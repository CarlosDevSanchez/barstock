-- 0018 offline sales: lets create_sale accept a sale rung up while the till had no connection (F2,
-- docs/06-roadmap/offline-y-sincronizacion.md). Decisions recorded there (2026-09-22):
--   - v1 scope: new sales only. Tabs, inventory adjustments and refunds stay disabled offline as today.
--   - No stock at sync time: the sale is still recorded (the money already changed hands); the shortfall is
--     tracked in `sync_issues` for a manager to review, not rejected.
--   - Offline window configurable via settings.offline_max_hours (default 12, admin only).

-- ---------------------------------------------------------------------------
-- orders: new columns
-- ---------------------------------------------------------------------------
alter table public.orders
  -- Same value as the idempotency key: lets the device match its provisional ticket to the synced order.
  add column client_ref  uuid unique,
  -- The device's clock at the time of the sale. Null for an online sale (its "occurred at" is just created_at).
  add column occurred_at timestamptz,
  add column source      text not null default 'online' check (source in ('online', 'offline')),
  -- Null when nothing was off: occurred_at_clamped, price_mismatch and/or stock_shortfall. See create_sale below.
  add column sync_issues jsonb,
  -- Filled in by the manager review flow (F4, not built yet): both null until then.
  add column reviewed_by uuid references auth.users (id),
  add column reviewed_at timestamptz;

create index orders_sync_issues_idx on public.orders (created_at) where sync_issues is not null;

-- ---------------------------------------------------------------------------
-- create_sale: accept p_occurred_at / p_expected_total
-- ---------------------------------------------------------------------------
drop function public.create_sale(uuid, jsonb, public.payment_method, numeric, uuid);

create or replace function public.create_sale(
  p_customer_id       uuid,
  p_items             jsonb,
  p_payment_method    public.payment_method,
  p_discount          numeric default 0,
  p_idempotency_key   uuid default null,
  p_occurred_at       timestamptz default null,
  p_expected_total    numeric default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_scale        int := public.money_scale();
  v_unit         numeric := power(10::numeric, v_scale);
  v_discount     numeric := coalesce(p_discount, 0);
  v_order_id     uuid;
  v_entry        jsonb;
  v_expanded     jsonb := '[]'::jsonb;
  v_item         record;
  v_name         text;
  v_price        numeric(14, 2);
  v_tax_rate     numeric;
  v_promo_id     uuid;
  v_line_discount numeric(14, 2);
  v_inv_id       uuid;
  v_available    int;
  v_taken        int;
  v_line_base    numeric(14, 2);
  v_line_tax     numeric(14, 2);
  v_subtotal     numeric(14, 2) := 0;
  v_tax          numeric(14, 2) := 0;
  v_total        numeric(14, 2);
  -- promotion expansion
  v_promo_name   text;
  v_package_price numeric(14, 2);
  v_packages     int;
  v_total_units  bigint;
  v_total_weight bigint;
  v_used_units   bigint;
  v_comp         record;
  v_comp_count   int;
  v_comp_idx     int;
  v_base_units   bigint;
  v_weight       bigint;
  v_qty          int;
  v_unit_price_units bigint;
  v_discount_units bigint;
  v_has_product  boolean;
  v_has_promo    boolean;
  -- idempotency
  v_request_hash text;
  v_existing_user uuid;
  v_existing_hash text;
  v_existing_result jsonb;
  -- offline
  v_source           text := case when p_occurred_at is null then 'online' else 'offline' end;
  v_occurred_at      timestamptz;
  v_offline_max_hours numeric;
  v_min_occurred     timestamptz;
  v_sync_issues      jsonb := '{}'::jsonb;
  v_stock_shortfall  jsonb := '[]'::jsonb;
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
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Too many items in one sale';
  end if;
  if p_customer_id is not null
     and not exists (
       select 1 from public.customers where id = p_customer_id and is_active and deleted_at is null
     ) then
    raise exception 'Customer not available';
  end if;

  if v_source = 'offline' then
    v_offline_max_hours := coalesce(
      (select (s.value #>> '{}')::numeric from public.settings s where s.key = 'offline_max_hours'),
      12
    );
    v_min_occurred := now() - make_interval(hours => v_offline_max_hours::int);
    if p_occurred_at < v_min_occurred or p_occurred_at > now() then
      v_occurred_at := least(greatest(p_occurred_at, v_min_occurred), now());
      v_sync_issues := v_sync_issues || jsonb_build_object(
        'occurred_at_clamped', jsonb_build_object('requested', p_occurred_at, 'used', v_occurred_at)
      );
    else
      v_occurred_at := p_occurred_at;
    end if;
  end if;

  if p_idempotency_key is not null then
    v_request_hash := md5(
      coalesce(p_customer_id::text, '') || '|' || p_items::text || '|' || p_payment_method::text || '|'
      || v_discount::text || '|' || coalesce(p_occurred_at::text, '') || '|' || coalesce(p_expected_total::text, '')
    );

    insert into public.idempotency_keys (key, user_id, action, request_hash)
    values (p_idempotency_key, v_uid, 'create_sale', v_request_hash)
    on conflict (key) do nothing;

    if not found then
      select user_id, request_hash, result
        into v_existing_user, v_existing_hash, v_existing_result
      from public.idempotency_keys
      where key = p_idempotency_key;

      if v_existing_user is not distinct from v_uid and v_existing_hash is not distinct from v_request_hash
         and v_existing_result is not null then
        -- Same call, already finished: hand back the order it created instead of ringing it up again.
        return (v_existing_result ->> 'order_id')::uuid;
      end if;
      -- Either a different call reused the key (different user/payload) or the owning call has not recorded a
      -- result yet, which create_sale being a single transaction means it never should while committed. Either
      -- way this is not safe to replay silently.
      raise exception 'This sale was already submitted, refresh and try again' using errcode = 'BS409';
    end if;
  end if;

  -- Expand cart entries into sellable product lines (promotion packages → components).
  for v_entry in select value from jsonb_array_elements(p_items) as t(value)
  loop
    v_has_product := (v_entry ? 'product_id') and nullif(v_entry ->> 'product_id', '') is not null;
    v_has_promo := (v_entry ? 'promotion_id') and nullif(v_entry ->> 'promotion_id', '') is not null;
    if v_has_product = v_has_promo then
      raise exception 'Each cart line must be a product or a promotion, not both';
    end if;

    if v_has_promo then
      v_promo_id := (v_entry ->> 'promotion_id')::uuid;
      v_packages := (v_entry ->> 'quantity')::int;
      if v_packages is null or v_packages <= 0 then
        raise exception 'Invalid quantity';
      end if;

      select pr.name, pr.package_price
        into v_promo_name, v_package_price
      from public.promotions pr
      where pr.id = v_promo_id
        and pr.is_active
        and pr.deleted_at is null;
      if not found then
        raise exception 'Promotion not available';
      end if;
      if v_package_price <> round(v_package_price, v_scale) then
        raise exception 'The price of "%" has more decimals than the store currency allows', v_promo_name;
      end if;

      select count(*)::int into v_comp_count
      from public.promotion_items pi
      join public.products p on p.id = pi.product_id
      where pi.promotion_id = v_promo_id
        and p.is_active
        and p.deleted_at is null;
      if v_comp_count = 0
         or v_comp_count <> (select count(*) from public.promotion_items where promotion_id = v_promo_id) then
        raise exception 'Promotion not available';
      end if;

      v_total_units := (round(v_package_price * v_unit))::bigint * v_packages;
      select coalesce(sum(greatest(0, (round(p.selling_price * v_unit))::bigint * pi.quantity)), 0)
        into v_total_weight
      from public.promotion_items pi
      join public.products p on p.id = pi.product_id
      where pi.promotion_id = v_promo_id;

      v_used_units := 0;
      v_comp_idx := 0;
      for v_comp in
        select pi.product_id,
               pi.quantity as per_package,
               p.name,
               p.selling_price,
               p.tax_rate,
               greatest(0, (round(p.selling_price * v_unit))::bigint * pi.quantity) as weight
        from public.promotion_items pi
        join public.products p on p.id = pi.product_id
        where pi.promotion_id = v_promo_id
        order by pi.product_id
      loop
        v_comp_idx := v_comp_idx + 1;
        v_qty := v_comp.per_package * v_packages;
        if v_comp_idx = v_comp_count then
          v_base_units := v_total_units - v_used_units;
        elsif v_total_weight = 0 then
          v_base_units := v_total_units / v_comp_count;
          v_used_units := v_used_units + v_base_units;
        else
          v_base_units := (v_total_units * v_comp.weight) / v_total_weight;
          v_used_units := v_used_units + v_base_units;
        end if;

        -- unit_price ceiled in minor units; discount absorbs excess (mirrors lib/promotion-allocate.ts)
        if v_qty <= 0 then
          raise exception 'Invalid quantity';
        end if;
        v_unit_price_units := (v_base_units + v_qty - 1) / v_qty;
        v_discount_units := v_unit_price_units * v_qty - v_base_units;

        v_expanded := v_expanded || jsonb_build_array(jsonb_build_object(
          'product_id', v_comp.product_id,
          'variant_id', null,
          'quantity', v_qty,
          'discount', (v_discount_units::numeric / v_unit),
          'unit_price', (v_unit_price_units::numeric / v_unit),
          'tax_rate', v_comp.tax_rate,
          'promotion_id', v_promo_id,
          'assigned', true
        ));
      end loop;
    else
      -- Plain product line: price/tax come from the catalog later.
      if (v_entry ->> 'quantity')::int is null or (v_entry ->> 'quantity')::int <= 0 then
        raise exception 'Invalid quantity';
      end if;
      v_expanded := v_expanded || jsonb_build_array(jsonb_build_object(
        'product_id', (v_entry ->> 'product_id')::uuid,
        'variant_id', nullif(v_entry ->> 'variant_id', '')::uuid,
        'quantity', (v_entry ->> 'quantity')::int,
        'discount', coalesce((v_entry ->> 'discount')::numeric, 0),
        'assigned', false
      ));
    end if;
  end loop;

  if jsonb_array_length(v_expanded) > 200 then
    raise exception 'Too many items in one sale';
  end if;

  insert into public.orders (order_number, customer_id, status, created_by, client_ref, occurred_at, source)
  values ('ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
          p_customer_id, 'completed', v_uid, p_idempotency_key, v_occurred_at, v_source)
  returning id into v_order_id;

  -- Sorted so concurrent sales lock inventory rows in the same order (no deadlocks).
  for v_item in
    select (e ->> 'product_id')::uuid                  as product_id,
           nullif(e ->> 'variant_id', '')::uuid        as variant_id,
           (e ->> 'quantity')::int                     as quantity,
           coalesce((e ->> 'discount')::numeric, 0)    as discount,
           (e ->> 'assigned')::boolean                 as assigned,
           (e ->> 'unit_price')::numeric               as assigned_price,
           (e ->> 'tax_rate')::numeric                 as assigned_tax_rate,
           nullif(e ->> 'promotion_id', '')::uuid      as promotion_id
    from jsonb_array_elements(v_expanded) e
    order by 1, 2 nulls first
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Invalid quantity';
    end if;
    if v_item.discount < 0 or v_item.discount <> round(v_item.discount, v_scale) then
      raise exception 'Invalid line discount';
    end if;

    if v_item.assigned then
      -- Package component: unit_price from allocation, never catalog selling_price.
      select p.name into v_name
      from public.products p
      where p.id = v_item.product_id
        and p.is_active
        and p.deleted_at is null;
      if not found then
        raise exception 'Product not available';
      end if;
      v_price := v_item.assigned_price;
      v_tax_rate := v_item.assigned_tax_rate;
      v_promo_id := v_item.promotion_id;
    else
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
      v_promo_id := null;
    end if;

    if v_price <> round(v_price, v_scale) then
      raise exception 'The price of "%" has more decimals than the store currency allows', v_name;
    end if;

    v_line_discount := v_item.discount;
    v_line_base := v_price * v_item.quantity - v_line_discount;
    if v_line_base < 0 then
      raise exception 'The discount exceeds the amount of "%"', v_name;
    end if;
    v_line_tax := round(v_line_base * v_tax_rate, v_scale);

    if v_source = 'offline' then
      -- The money already changed hands: never reject for stock. Take what is there (down to 0, the CHECK still
      -- holds) and record the rest as a shortfall for a manager to reconcile (F4, not built yet).
      select id, quantity into v_inv_id, v_available
      from public.inventory
      where product_id = v_item.product_id
        and variant_id is not distinct from v_item.variant_id
      for update;
      if v_inv_id is null then
        raise exception 'Product not available';
      end if;
      v_taken := least(v_available, v_item.quantity);
      if v_taken > 0 then
        update public.inventory set quantity = quantity - v_taken where id = v_inv_id;
        insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, created_by)
        values (v_inv_id, 'sale', -v_taken, v_order_id, v_uid);
      end if;
      if v_taken < v_item.quantity then
        v_stock_shortfall := v_stock_shortfall || jsonb_build_array(jsonb_build_object(
          'product_id', v_item.product_id, 'missing', v_item.quantity - v_taken
        ));
      end if;
    else
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
      insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, created_by)
      values (v_inv_id, 'sale', -v_item.quantity, v_order_id, v_uid);
    end if;

    insert into public.order_items (order_id, product_id, variant_id, quantity, unit_price, discount, tax, total,
                                    tax_rate, promotion_id)
    values (v_order_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price,
            v_line_discount, v_line_tax, v_line_base + v_line_tax, v_tax_rate, v_promo_id);

    v_subtotal := v_subtotal + v_line_base;
    v_tax      := v_tax + v_line_tax;
  end loop;

  v_total := v_subtotal + v_tax - v_discount;
  if v_total < 0 then
    raise exception 'The discount exceeds the order total';
  end if;

  if jsonb_array_length(v_stock_shortfall) > 0 then
    v_sync_issues := v_sync_issues || jsonb_build_object('stock_shortfall', v_stock_shortfall);
  end if;
  -- The client's provisional total is never trusted for money, only compared: the server's total always wins.
  if p_expected_total is not null and round(p_expected_total, v_scale) <> v_total then
    v_sync_issues := v_sync_issues
      || jsonb_build_object('price_mismatch', jsonb_build_object('expected', p_expected_total, 'actual', v_total));
  end if;

  update public.orders
     set subtotal = v_subtotal, discount = v_discount, tax = v_tax, total = v_total,
         sync_issues = nullif(v_sync_issues, '{}'::jsonb)
   where id = v_order_id;

  insert into public.payments (order_id, payment_method, amount)
  values (v_order_id, p_payment_method, v_total);

  if p_idempotency_key is not null then
    update public.idempotency_keys
       set result = jsonb_build_object('order_id', v_order_id)
     where key = p_idempotency_key;
  end if;

  return v_order_id;
end;
$$;

revoke all on function public.create_sale(uuid, jsonb, public.payment_method, numeric, uuid, timestamptz, numeric)
  from public, anon;
grant execute on function public.create_sale(uuid, jsonb, public.payment_method, numeric, uuid, timestamptz, numeric)
  to authenticated;

-- ---------------------------------------------------------------------------
-- reporting: group/filter by when the sale actually happened, not when it reached the server
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_tz text default null)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_tz     text := coalesce(nullif(p_tz, ''),
                            (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
                            'UTC');
  v_today  date := (now() at time zone v_tz)::date;
  v_month  date := date_trunc('month', (now() at time zone v_tz))::date;
  v_result jsonb;
begin
  if not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  with o as (
    select ord.id, ord.total, (coalesce(ord.occurred_at, ord.created_at) at time zone v_tz)::date as day
    from public.orders ord
    where ord.status = 'completed'
      and coalesce(ord.occurred_at, ord.created_at) >= (least(v_month, v_today - 29))::timestamp at time zone v_tz
  )
  select jsonb_build_object(
    'time_zone', v_tz,
    'today_revenue', (select coalesce(sum(total), 0) from o where day = v_today),
    'today_orders', (select count(*) from o where day = v_today),
    'month_revenue', (select coalesce(sum(total), 0) from o where day >= v_month),
    'total_customers', (select count(*) from public.customers),
    'low_stock_count', (
      select count(*)
      from public.inventory i
      join public.products p on p.id = i.product_id
      where i.variant_id is null and p.is_active and p.deleted_at is null
        and i.quantity <= i.low_stock_threshold),
    'sales_last_7_days', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(g.d, 'YYYY-MM-DD'),
               'revenue', coalesce(x.revenue, 0),
               'orders', coalesce(x.orders, 0)) order by g.d), '[]'::jsonb)
      from generate_series(v_today - 6, v_today, interval '1 day') as g(d)
      left join (select day, sum(total) as revenue, count(*) as orders from o group by day) x
             on x.day = g.d::date),
    'top_products', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.quantity desc, t.revenue desc), '[]'::jsonb)
      from (
        select p.id as product_id, p.name, sum(oi.quantity)::int as quantity, sum(oi.total) as revenue
        from public.order_items oi
        join o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        where o.day >= v_today - 29
        group by p.id, p.name
        order by quantity desc, revenue desc
        limit 5) t),
    'low_stock_items', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.quantity, t.product_name), '[]'::jsonb)
      from (
        select i.id as inventory_id, p.id as product_id, p.name as product_name, p.sku,
               i.quantity, i.low_stock_threshold
        from public.inventory i
        join public.products p on p.id = i.product_id
        where i.variant_id is null and p.is_active and p.deleted_at is null
          and i.quantity <= i.low_stock_threshold
        order by i.quantity, p.name
        limit 5) t)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.sales_report(p_from date, p_to date, p_tz text default null)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_tz     text := coalesce(nullif(p_tz, ''),
                            (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
                            'UTC');
  v_start  timestamptz;
  v_end    timestamptz;
  v_result jsonb;
begin
  if not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range';
  end if;
  if p_to - p_from > 366 then
    raise exception 'The range cannot exceed 366 days';
  end if;

  v_start := p_from::timestamp at time zone v_tz;
  v_end   := (p_to + 1)::timestamp at time zone v_tz;

  with o as (
    select ord.id, ord.customer_id, ord.subtotal, ord.discount, ord.tax, ord.total,
           (coalesce(ord.occurred_at, ord.created_at) at time zone v_tz)::date as day
    from public.orders ord
    where ord.status = 'completed'
      and coalesce(ord.occurred_at, ord.created_at) >= v_start
      and coalesce(ord.occurred_at, ord.created_at) < v_end
  ),
  line_money as (
    select
      oi.order_id,
      oi.product_id,
      oi.promotion_id,
      oi.quantity,
      oi.total as line_total,
      (oi.unit_price * oi.quantity - oi.discount) as line_base,
      (p.selling_price * oi.quantity) as list_base,
      (p.cost_price * oi.quantity) as line_cogs
    from public.order_items oi
    join o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
  ),
  pkg_per_order as (
    -- Packages sold on one order for one promo ≈ min(component_qty / recipe_qty).
    select
      oi.order_id,
      oi.promotion_id,
      min(oi.quantity / pi.quantity)::int as packages
    from public.order_items oi
    join o on o.id = oi.order_id
    join public.promotion_items pi
      on pi.promotion_id = oi.promotion_id and pi.product_id = oi.product_id
    where oi.promotion_id is not null
      and pi.quantity > 0
    group by oi.order_id, oi.promotion_id
  )
  select jsonb_build_object(
    'from', to_char(p_from, 'YYYY-MM-DD'),
    'to', to_char(p_to, 'YYYY-MM-DD'),
    'time_zone', v_tz,
    'total_orders', (select count(*) from o),
    'total_revenue', (select coalesce(sum(total), 0) from o),
    'total_tax', (select coalesce(sum(tax), 0) from o),
    'total_discount', (select coalesce(sum(discount), 0) from o),
    'average_order', (select coalesce(round(avg(total), 2), 0) from o),
    'promo_markdown', (
      select coalesce(sum(list_base - line_base), 0)
      from line_money
      where promotion_id is not null
    ),
    'total_cogs', (select coalesce(sum(line_cogs), 0) from line_money),
    'gross_profit', (
      select coalesce(sum(line_base), 0) - coalesce(sum(line_cogs), 0)
      from line_money
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(g.d, 'YYYY-MM-DD'),
               'revenue', coalesce(x.revenue, 0),
               'orders', coalesce(x.orders, 0)) order by g.d), '[]'::jsonb)
      from generate_series(p_from, p_to, interval '1 day') as g(d)
      left join (select day, sum(total) as revenue, count(*) as orders from o group by day) x
             on x.day = g.d::date),
    'top_products', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.revenue desc, t.quantity desc), '[]'::jsonb)
      from (
        select
          p.id as product_id,
          p.name,
          sum(lm.quantity)::int as quantity,
          sum(lm.line_total) as revenue,
          sum(lm.line_cogs) as cogs,
          sum(lm.line_base) - sum(lm.line_cogs) as gross_profit
        from line_money lm
        join public.products p on p.id = lm.product_id
        group by p.id, p.name
        order by revenue desc, quantity desc
        limit 10) t),
    'top_promotions', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.revenue desc, t.packages desc), '[]'::jsonb)
      from (
        select
          pr.id as promotion_id,
          pr.name,
          (select count(*)::int from pkg_per_order p where p.promotion_id = pr.id) as orders,
          (select coalesce(sum(p.packages), 0)::int from pkg_per_order p where p.promotion_id = pr.id) as packages,
          (select coalesce(sum(lm.line_total), 0) from line_money lm where lm.promotion_id = pr.id) as revenue
        from public.promotions pr
        where exists (select 1 from line_money lm where lm.promotion_id = pr.id)
        order by revenue desc, packages desc
        limit 10) t),
    'top_customers', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.spent desc), '[]'::jsonb)
      from (
        select c.id as customer_id, c.name, count(*)::int as orders, sum(o.total) as spent
        from o
        join public.customers c on c.id = o.customer_id
        group by c.id, c.name
        order by spent desc
        limit 5) t),
    'by_payment_method', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.amount desc), '[]'::jsonb)
      from (
        select pay.payment_method as method, count(*)::int as orders, sum(pay.amount) as amount
        from public.payments pay
        join o on o.id = pay.order_id
        group by pay.payment_method) t)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.dashboard_summary(text) from public, anon;
revoke all on function public.sales_report(date, date, text) from public, anon;
grant execute on function public.dashboard_summary(text) to authenticated;
grant execute on function public.sales_report(date, date, text) to authenticated;

create or replace function public.top_selling_products(p_days int default 30, p_limit int default 5)
returns table (
  product_id     uuid,
  name           text,
  selling_price  numeric,
  stock          int,
  category_name  text,
  quantity       bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'Invalid range';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'Invalid limit';
  end if;

  return query
    select
      p.id as product_id,
      p.name,
      p.selling_price,
      i.quantity as stock,
      c.name as category_name,
      sum(oi.quantity)::bigint as quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    left join public.inventory i on i.product_id = p.id and i.variant_id is null
    left join public.categories c on c.id = p.category_id
    where o.status = 'completed'
      and coalesce(o.occurred_at, o.created_at) >= now() - make_interval(days => p_days)
      and p.is_active
      and p.deleted_at is null
    group by p.id, p.name, p.selling_price, i.quantity, c.name
    order by sum(oi.quantity) desc, sum(oi.total) desc, p.name
    limit p_limit;
end;
$$;

revoke all on function public.top_selling_products(int, int) from public, anon;
grant execute on function public.top_selling_products(int, int) to authenticated;
