-- tab_add_items: accept promotion packages (same expansion + assigned prices as create_sale).
-- tab_items gains promotion_id + discount so combo lines stay separate from list-price SKUs
-- and package totals match create_sale (unit ceil + line discount).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.tab_items
  add column if not exists promotion_id uuid references public.promotions (id),
  add column if not exists discount numeric(14, 2) not null default 0
    check (discount >= 0);

alter table public.tab_items
  drop constraint if exists tab_items_tab_id_product_id_variant_id_key;

alter table public.tab_items
  add constraint tab_items_tab_product_variant_promo_key
  unique nulls not distinct (tab_id, product_id, variant_id, promotion_id);

create index if not exists tab_items_promotion_idx
  on public.tab_items (promotion_id)
  where promotion_id is not null;

-- ---------------------------------------------------------------------------
-- _tab_totals: base = unit_price × qty − discount (aligned with create_sale / order_items)
-- ---------------------------------------------------------------------------
create or replace function public._tab_totals(p_tab_id uuid)
returns table (subtotal numeric, tax numeric, discount numeric, total numeric, paid numeric, balance numeric)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_scale    int := public.money_scale();
  v_discount numeric(14, 2);
  v_subtotal numeric(14, 2) := 0;
  v_tax      numeric(14, 2) := 0;
  v_total    numeric(14, 2);
  v_paid     numeric(14, 2);
  v_item     record;
  v_base     numeric(14, 2);
begin
  select t.discount into v_discount from public.tabs t where t.id = p_tab_id;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;

  for v_item in
    select ti.quantity, ti.unit_price, ti.tax_rate, ti.discount
    from public.tab_items ti
    where ti.tab_id = p_tab_id
  loop
    v_base := v_item.unit_price * v_item.quantity - v_item.discount;
    if v_base < 0 then
      raise exception 'Invalid tab line';
    end if;
    v_subtotal := v_subtotal + v_base;
    v_tax := v_tax + round(v_base * v_item.tax_rate, v_scale);
  end loop;

  v_total := greatest(v_subtotal + v_tax - v_discount, 0);
  select coalesce(sum(amount), 0) into v_paid from public.tab_payments where tab_id = p_tab_id;

  return query select v_subtotal, v_tax, v_discount, v_total, v_paid, greatest(v_total - v_paid, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- _close_tab: copy promotion_id + line discount onto order_items
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

  insert into public.order_items (
    order_id, product_id, variant_id, quantity, unit_price, discount, tax, total, tax_rate, promotion_id
  )
  select
    v_order_id,
    ti.product_id,
    ti.variant_id,
    ti.quantity,
    ti.unit_price,
    ti.discount,
    round((ti.unit_price * ti.quantity - ti.discount) * ti.tax_rate, v_scale),
    (ti.unit_price * ti.quantity - ti.discount)
      + round((ti.unit_price * ti.quantity - ti.discount) * ti.tax_rate, v_scale),
    ti.tax_rate,
    ti.promotion_id
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
-- tab_add_items: product OR promotion lines; expand packages like create_sale
-- ---------------------------------------------------------------------------
create or replace function public.tab_add_items(p_tab_id uuid, p_items jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_scale        int := public.money_scale();
  v_unit         numeric := power(10::numeric, v_scale);
  v_status       public.tab_status;
  v_entry        jsonb;
  v_expanded     jsonb := '[]'::jsonb;
  v_item         record;
  v_name         text;
  v_price        numeric(14, 2);
  v_tax_rate     numeric;
  v_promo_id     uuid;
  v_line_discount numeric(14, 2);
  v_inv_id       uuid;
  v_has_product  boolean;
  v_has_promo    boolean;
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
  v_qty          int;
  v_unit_price_units bigint;
  v_discount_units bigint;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No items to add';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Too many items at once';
  end if;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open';
  end if;

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
    raise exception 'Too many items at once';
  end if;

  -- Sorted so concurrent additions lock inventory rows in the same order (no deadlocks).
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
    order by 1, 2 nulls first, 8 nulls first
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Invalid quantity';
    end if;
    if v_item.discount < 0 or v_item.discount <> round(v_item.discount, v_scale) then
      raise exception 'Invalid line discount';
    end if;

    if v_item.assigned then
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
      v_line_discount := v_item.discount;
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
      v_line_discount := v_item.discount;
    end if;

    if v_price <> round(v_price, v_scale) then
      raise exception 'The price of "%" has more decimals than the store currency allows', v_name;
    end if;
    if v_price * v_item.quantity - v_line_discount < 0 then
      raise exception 'The discount exceeds the amount of "%"', v_name;
    end if;

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

    -- Price photo on first add; repeats sum quantity + discount, never re-price.
    insert into public.tab_items (
      tab_id, product_id, variant_id, quantity, unit_price, tax_rate, discount, promotion_id, added_by
    )
    values (
      p_tab_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price, v_tax_rate,
      v_line_discount, v_promo_id, v_uid
    )
    on conflict (tab_id, product_id, variant_id, promotion_id)
    do update set
      quantity = public.tab_items.quantity + excluded.quantity,
      discount = public.tab_items.discount + excluded.discount,
      updated_at = now();

    insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, created_by)
    values (v_inv_id, 'sale', -v_item.quantity, p_tab_id, v_uid);
  end loop;

  update public.tabs set updated_at = now() where id = p_tab_id;
end;
$$;
