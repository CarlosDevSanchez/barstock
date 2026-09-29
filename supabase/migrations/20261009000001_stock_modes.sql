-- Stock modes: products that do not track stock (coffee) and presentations that share another product's stock
-- (a box of 15 cigarettes sells 15 units of the single cigarette). See docs/03-modulos/productos.md.
--
--   own    : the product has its own inventory row (the only behavior before this migration).
--   none   : always sellable, never touches inventory. Its inventory row (created by the trigger) is ignored.
--   linked : selling 1 takes `stock_units` from the inventory row of `stock_product_id` (the base, always `own`).
--            Stock is counted in the base's smallest unit; there is only one level (a base cannot be linked).
--
-- Every sold/tab/purchase line keeps a photo of where its stock went (`stock_product_id`, `stock_units`) so that a
-- refund, a tab removal/void or a purchase void puts it back in the same place even if the product changes later.
-- `stock_units` null = row from before this migration (own product, factor 1); 0 = untracked (nothing moves).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.products
  add column stock_mode text not null default 'own',
  add column stock_product_id uuid references public.products (id),
  add column stock_units int not null default 1;

alter table public.products
  add constraint products_stock_mode_check check (stock_mode in ('own', 'none', 'linked')),
  add constraint products_stock_units_check check (stock_units between 1 and 10000),
  add constraint products_stock_link_check check ((stock_mode = 'linked') = (stock_product_id is not null)),
  add constraint products_stock_units_own_check check (stock_mode = 'linked' or stock_units = 1),
  add constraint products_stock_not_self_check check (stock_product_id is distinct from id);

create index products_stock_product_idx on public.products (stock_product_id) where stock_product_id is not null;

-- Photos, not relations: no FK (a second FK to products would make PostgREST's `products(...)` embeds ambiguous).
alter table public.order_items
  add column stock_product_id uuid,
  add column stock_units int check (stock_units >= 0);
alter table public.tab_items
  add column stock_product_id uuid,
  add column stock_units int check (stock_units >= 0);
alter table public.purchase_order_items
  add column stock_product_id uuid,
  add column stock_units int check (stock_units >= 1);

-- stock_taken is now measured in units of the stock row it came from (the base for a presentation).
alter table public.order_items drop constraint order_items_stock_taken_range;
alter table public.order_items
  add constraint order_items_stock_taken_range
  check (stock_taken is null or stock_taken between 0 and quantity * coalesce(nullif(stock_units, 0), 1));

-- ---------------------------------------------------------------------------
-- Guard: coherent links, one level, no stock left behind when a product stops owning it
-- ---------------------------------------------------------------------------
create or replace function public._products_stock_mode_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_base record;
  v_qty  int;
begin
  if new.stock_mode = 'linked' then
    select stock_mode, deleted_at into v_base from public.products where id = new.stock_product_id for share;
    if not found or v_base.deleted_at is not null then
      raise exception 'The base product does not exist' using errcode = 'BS409';
    end if;
    if v_base.stock_mode <> 'own' then
      raise exception 'The base product must track its own stock' using errcode = 'BS409';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- A base keeps owning its stock (and cannot be deleted) while a live presentation points at it.
    if (new.stock_mode <> 'own' or (new.deleted_at is not null and old.deleted_at is null))
       and exists (
         select 1 from public.products c
         where c.stock_product_id = new.id and c.deleted_at is null and c.id <> new.id
       ) then
      raise exception 'This product is the base of other presentations' using errcode = 'BS409';
    end if;
    -- Leaving `own` with units on the shelf would hide them: the manager adjusts them to 0 first.
    if old.stock_mode = 'own' and new.stock_mode <> 'own' then
      select coalesce(sum(quantity), 0) into v_qty from public.inventory where product_id = new.id;
      if v_qty > 0 then
        raise exception 'Adjust this product''s stock to 0 before changing how it is tracked' using errcode = 'BS409';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._products_stock_mode_guard() from public, anon, authenticated;

create trigger products_stock_mode_guard
  before insert or update of stock_mode, stock_product_id, stock_units, deleted_at on public.products
  for each row execute function public._products_stock_mode_guard();

-- ---------------------------------------------------------------------------
-- Helpers used by every RPC that moves stock
-- ---------------------------------------------------------------------------

-- Where a line of `p_product_id` takes its stock from, right now. units = 0 means "not tracked".
create or replace function public._stock_target(
  p_product_id uuid,
  p_variant_id uuid default null,
  out inventory_id uuid,
  out stock_product_id uuid,
  out units int
)
language sql stable security definer
set search_path = ''
as $$
  select i.id,
         case when p.stock_mode = 'none' then null else coalesce(p.stock_product_id, p.id) end,
         case p.stock_mode when 'none' then 0 when 'linked' then p.stock_units else 1 end
  from public.products p
  left join public.inventory i
    on p.stock_mode <> 'none'
   and i.product_id = coalesce(p.stock_product_id, p.id)
   and i.variant_id is not distinct from (case when p.stock_mode = 'linked' then null else p_variant_id end)
  where p.id = p_product_id
$$;

-- Locks inventory rows in one global order (product, variant) so callers that touch several rows through
-- presentations never deadlock against each other.
create or replace function public._lock_inventory(p_ids uuid[])
returns void
language sql security definer
set search_path = ''
as $$
  select null from (
    select 1 from public.inventory
    where id = any (coalesce(p_ids, '{}'))
    order by product_id, variant_id nulls first
    for update
  ) locked
$$;

-- Takes the stock of one sold line. `p_lenient` (offline sync) never rejects: it takes what there is and the caller
-- records the difference. `p_units`/`p_stock_product_id` override the current target (a tab line that already has a
-- photo keeps using it). Returns where it went and how many base units were actually taken.
create or replace function public._take_stock(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity int,
  p_reference uuid,
  p_uid uuid,
  p_label text,
  p_lenient boolean default false,
  p_stock_product_id uuid default null,
  p_units int default null,
  out stock_product_id uuid,
  out stock_units int,
  out taken int
)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv_id   uuid;
  v_avail    int;
  v_need     int;
  v_variant  uuid;
begin
  if p_units is not null then
    stock_units := p_units;
    stock_product_id := p_stock_product_id;
  else
    select t.stock_product_id, t.units into stock_product_id, stock_units
    from public._stock_target(p_product_id, p_variant_id) t;
    if stock_units is null then
      raise exception 'Product not available';
    end if;
  end if;

  if stock_units = 0 then
    stock_product_id := null;
    taken := 0;
    return;
  end if;

  v_variant := case when stock_product_id = p_product_id then p_variant_id else null end;
  v_need := p_quantity * stock_units;

  if p_lenient then
    select id, quantity into v_inv_id, v_avail
    from public.inventory
    where product_id = stock_product_id and variant_id is not distinct from v_variant
    for update;
    if v_inv_id is null then
      raise exception 'Product not available';
    end if;
    taken := least(v_avail, v_need);
  else
    update public.inventory
       set quantity = quantity - v_need
     where product_id = stock_product_id
       and variant_id is not distinct from v_variant
       and quantity >= v_need
    returning id into v_inv_id;
    if v_inv_id is null then
      raise exception 'Insufficient stock for "%"', p_label;
    end if;
    taken := v_need;
  end if;

  if taken > 0 then
    if p_lenient then
      update public.inventory set quantity = quantity - taken where id = v_inv_id;
    end if;
    insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, created_by)
    values (v_inv_id, 'sale', -taken, p_reference, p_uid);
  end if;
end;
$$;

-- Puts back `p_base_qty` units of a line whose photo is (`p_stock_product_id`, `p_units`). Legacy lines
-- (`p_units` null) go back to the line's own product, untracked ones (0) move nothing.
create or replace function public._return_stock(
  p_product_id uuid,
  p_variant_id uuid,
  p_stock_product_id uuid,
  p_units int,
  p_base_qty int,
  p_reference uuid,
  p_notes text,
  p_uid uuid
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_target uuid := case when p_units is null then p_product_id else p_stock_product_id end;
  v_inv_id uuid;
begin
  if p_units = 0 or v_target is null or coalesce(p_base_qty, 0) <= 0 then
    return;
  end if;
  update public.inventory
     set quantity = quantity + p_base_qty
   where product_id = v_target
     and variant_id is not distinct from (case when v_target = p_product_id then p_variant_id else null end)
  returning id into v_inv_id;
  if v_inv_id is not null then
    insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, notes, created_by)
    values (v_inv_id, 'return', p_base_qty, p_reference, p_notes, p_uid);
  end if;
end;
$$;

revoke all on function public._stock_target(uuid, uuid) from public, anon, authenticated;
revoke all on function public._lock_inventory(uuid[]) from public, anon, authenticated;
revoke all on function public._take_stock(uuid, uuid, int, uuid, uuid, text, boolean, uuid, int)
  from public, anon, authenticated;
revoke all on function public._return_stock(uuid, uuid, uuid, int, int, uuid, text, uuid)
  from public, anon, authenticated;


create or replace function public.create_sale(
  p_customer_id       uuid,
  p_items             jsonb,
  p_payment_method    public.payment_method default null,
  p_discount          numeric default 0,
  p_idempotency_key   uuid default null,
  p_occurred_at       timestamptz default null,
  p_expected_total    numeric default null,
  p_payments          jsonb default null
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
  v_customer_id      uuid;
  v_occurred_at      timestamptz;
  v_offline_max_hours numeric;
  v_min_occurred     timestamptz;
  v_sync_issues      jsonb := '{}'::jsonb;
  v_stock_shortfall  jsonb := '[]'::jsonb;
  v_pr_ok            boolean;
  v_p_ok             boolean;
  v_stale_products   uuid[] := '{}';
  v_stale_promotions uuid[] := '{}';
  v_pay_canon     text;
  v_pay           jsonb;
  v_pay_method    public.payment_method;
  v_pay_methods_seen text[] := '{}'; -- B7: same rule as pay_receivable, methods in one sale must be distinct
  v_adjust_cash_idx  int;
  v_first_method     public.payment_method;
  v_current_status   text;
  v_payments_before  jsonb;
  v_drain0           int;
  v_drain1           int;
  v_amt0             numeric(14, 2);
  v_amt1             numeric(14, 2);
  v_new0             numeric(14, 2);
  v_new1             numeric(14, 2);
  v_delta            numeric(14, 2);
  v_pay_amount    numeric(14, 2);
  v_pay_count     int;
  v_pay_sum       numeric(14, 2);
  v_pay_index     int;
  v_adjust_index  int;
  v_adjust_before numeric(14, 2);
  v_adjust_after  numeric(14, 2);
  v_payments      jsonb;
  v_business_day_id uuid;
  v_cash_session_id uuid;
  -- stock modes
  v_stock_product_id uuid;
  v_stock_units      int;
  v_lock_ids         uuid[];
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform public._auto_close_stale_business_days();
  -- p_payments null keeps the single-method path (older offline entries). Both null is an error.
  if p_payments is null then
    if p_payment_method is null then
      raise exception 'A payment method is required' using errcode = 'P0001';
    end if;
    v_pay_canon := p_payment_method::text;
  else
    if jsonb_typeof(p_payments) is distinct from 'array' then
      raise exception 'Invalid payments' using errcode = 'P0001';
    end if;
    v_pay_count := jsonb_array_length(p_payments);
    if v_pay_count < 1 or v_pay_count > 2 then
      raise exception 'Invalid payments' using errcode = 'P0001';
    end if;
    v_pay_canon := '';
    for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
    loop
      if (v_pay ->> 'method') is null
         or (v_pay ->> 'method') not in ('cash', 'card', 'ewallet') then
        raise exception 'Invalid payment method' using errcode = 'P0001';
      end if;
      v_pay_method := (v_pay ->> 'method')::public.payment_method;
      -- B7 (U4): same-method duplicates are rejected here too, matching pay_receivable.
      if v_pay_method::text = any (v_pay_methods_seen) then
        raise exception 'Payment methods must be distinct' using errcode = 'P0001';
      end if;
      v_pay_methods_seen := array_append(v_pay_methods_seen, v_pay_method::text);
      v_pay_amount := (v_pay ->> 'amount')::numeric;
      if v_pay_amount is null or v_pay_amount <= 0 or v_pay_amount <> round(v_pay_amount, v_scale) then
        raise exception 'Invalid amount' using errcode = 'P0001';
      end if;
      v_pay_canon := v_pay_canon
        || case when v_pay_canon = '' then '' else ',' end
        || v_pay_method::text || ':' || v_pay_amount::text;
    end loop;
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

  -- Idempotency, checked before anything that depends on mutable state (customer/product availability): a retry
  -- of an already-committed sale (the response to a first, online attempt got lost, and the same client_ref gets
  -- resent through the offline queue) must return the original order even if a customer/product involved became
  -- unavailable in between, not fail forever. The hash intentionally excludes occurred_at/expected_total: they can
  -- legitimately differ between the lost online attempt and its offline resend of the same economic sale.
  -- The payment segment is p_payment_method when p_payments is null, so a retry of a sale stored before split
  -- payments still matches; otherwise it is the normalized method:amount list.
  if p_idempotency_key is not null then
    v_request_hash := md5(
      coalesce(p_customer_id::text, '') || '|' || p_items::text || '|' || v_pay_canon || '|'
      || v_discount::text
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

  v_customer_id := p_customer_id;
  if p_customer_id is not null
     and not exists (
       select 1 from public.customers where id = p_customer_id and is_active and deleted_at is null
     ) then
    if v_source = 'offline' then
      -- The money already changed hands: do not lose the sale over a customer deactivated in the meantime -
      -- record it walk-in, keeping who was actually requested for a manager to see, and flag it for review.
      v_customer_id := null;
      v_sync_issues := v_sync_issues
        || jsonb_build_object('customer_unavailable', jsonb_build_object('requested', p_customer_id));
    else
      raise exception 'Customer not available';
    end if;
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

      -- Offline: fall back to the promotion's last known state (soft-delete only, so the row always exists) rather
      -- than rejecting a sale whose money already changed hands.
      select pr.name, pr.package_price, (pr.is_active and pr.deleted_at is null)
        into v_promo_name, v_package_price, v_pr_ok
      from public.promotions pr
      where pr.id = v_promo_id
        and (v_source = 'offline' or (pr.is_active and pr.deleted_at is null));
      if not found then
        raise exception 'Promotion not available';
      end if;
      if not v_pr_ok then
        v_stale_promotions := array_append(v_stale_promotions, v_promo_id);
      end if;
      if v_package_price <> round(v_package_price, v_scale) then
        raise exception 'The price of "%" has more decimals than the store currency allows', v_promo_name;
      end if;

      select count(*)::int into v_comp_count
      from public.promotion_items pi
      join public.products p on p.id = pi.product_id
      where pi.promotion_id = v_promo_id
        and (v_source = 'offline' or (p.is_active and p.deleted_at is null));
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

  select a.business_day_id, a.cash_session_id
    into v_business_day_id, v_cash_session_id
    from public._current_assignment(v_uid, coalesce(v_occurred_at, now())) a;

  -- B2 (M9): _current_assignment is stable within this transaction, so a concurrent close_cash_session could
  -- already be past its own `for update` and about to commit `status = 'closed'`. Re-check under a lock: if the
  -- session is (or is about to be) closed, this sale falls back to no cash session rather than landing outside
  -- the till it claims to be in.
  if v_cash_session_id is not null then
    select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
    if v_current_status is distinct from 'open' then
      v_cash_session_id := null;
    end if;
  end if;

  insert into public.orders (
    order_number, customer_id, status, created_by, client_ref, occurred_at, source, business_day_id, cash_session_id,
    settled_at
  )
  values ('ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
          v_customer_id, 'completed', v_uid, p_idempotency_key, v_occurred_at, v_source,
          v_business_day_id, v_cash_session_id, coalesce(v_occurred_at, now()))
  returning id into v_order_id;

  -- Lock every stock row this sale touches (presentations resolve to their base) in one global order, so
  -- concurrent sales never deadlock however their lines are sorted.
  select array_agg(t.inventory_id) into v_lock_ids
  from jsonb_array_elements(v_expanded) e
  cross join lateral public._stock_target((e ->> 'product_id')::uuid, nullif(e ->> 'variant_id', '')::uuid) t
  where t.inventory_id is not null;
  perform public._lock_inventory(v_lock_ids);

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
      -- Package component: unit_price from allocation, never catalog selling_price. Offline: the component's
      -- name/existence is looked up leniently too, and flagged the same way a plain product line would be.
      select p.name, (p.is_active and p.deleted_at is null) into v_name, v_p_ok
      from public.products p
      where p.id = v_item.product_id
        and (v_source = 'offline' or (p.is_active and p.deleted_at is null));
      if not found then
        raise exception 'Product not available';
      end if;
      if not v_p_ok then
        v_stale_products := array_append(v_stale_products, v_item.product_id);
      end if;
      v_price := v_item.assigned_price;
      v_tax_rate := v_item.assigned_tax_rate;
      v_promo_id := v_item.promotion_id;
    else
      select p.name, coalesce(v.selling_price, p.selling_price), p.tax_rate, (p.is_active and p.deleted_at is null)
        into v_name, v_price, v_tax_rate, v_p_ok
      from public.products p
      left join public.product_variants v on v.id = v_item.variant_id and v.product_id = p.id
      where p.id = v_item.product_id
        and (v_source = 'offline' or (p.is_active and p.deleted_at is null))
        and (v_item.variant_id is null or v.id is not null);
      if not found then
        raise exception 'Product not available';
      end if;
      if not v_p_ok then
        v_stale_products := array_append(v_stale_products, v_item.product_id);
      end if;
      v_promo_id := null;
    end if;

    if v_price <> round(v_price, v_scale) then
      raise exception 'The price of "%" has more decimals than the store currency allows', v_name;
    end if;

    v_line_discount := v_item.discount;
    v_line_base := v_price * v_item.quantity - v_line_discount;
    if v_line_base < 0 then
      if v_source = 'offline' then
        -- The price on record dropped since this line was rung up offline: clamp the discount to the line total
        -- instead of losing the whole sale over it.
        v_line_discount := v_price * v_item.quantity;
        v_line_base := 0;
        v_sync_issues := v_sync_issues || jsonb_build_object('discount_clamped', true);
      else
        raise exception 'The discount exceeds the amount of "%"', v_name;
      end if;
    end if;
    v_line_tax := round(v_line_base * v_tax_rate, v_scale);

    -- Untracked products take nothing; presentations take quantity × units from their base. Offline, the money
    -- already changed hands: never reject for stock, take what is there (down to 0, the CHECK still holds) and
    -- record the rest (in units of the stock row, named by its product) as a shortfall for a manager to reconcile.
    select t.stock_product_id, t.stock_units, t.taken
      into v_stock_product_id, v_stock_units, v_taken
    from public._take_stock(v_item.product_id, v_item.variant_id, v_item.quantity, v_order_id, v_uid, v_name,
                            v_source = 'offline') t;
    if v_taken < v_item.quantity * v_stock_units then
      v_stock_shortfall := v_stock_shortfall || jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product_id, 'missing', v_item.quantity * v_stock_units - v_taken
      ));
    end if;

    insert into public.order_items (order_id, product_id, variant_id, quantity, unit_price, discount, tax, total,
                                    tax_rate, promotion_id, stock_taken, stock_product_id, stock_units,
                                    unit_cost)
    values (v_order_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price,
            v_line_discount, v_line_tax, v_line_base + v_line_tax, v_tax_rate, v_promo_id, v_taken,
            v_stock_product_id, v_stock_units,
            (select coalesce(v.cost_price, p.cost_price) from public.products p
               left join public.product_variants v on v.id = v_item.variant_id
              where p.id = v_item.product_id));

    v_subtotal := v_subtotal + v_line_base;
    v_tax      := v_tax + v_line_tax;
  end loop;

  v_total := v_subtotal + v_tax - v_discount;
  if v_total < 0 then
    if v_source = 'offline' then
      v_discount := v_subtotal + v_tax;
      v_total := 0;
      v_sync_issues := v_sync_issues || jsonb_build_object('discount_clamped', true);
    else
      raise exception 'The discount exceeds the order total';
    end if;
  end if;

  if jsonb_array_length(v_stock_shortfall) > 0 then
    v_sync_issues := v_sync_issues || jsonb_build_object('stock_shortfall', v_stock_shortfall);
  end if;
  if array_length(v_stale_products, 1) > 0 or array_length(v_stale_promotions, 1) > 0 then
    v_sync_issues := v_sync_issues || jsonb_build_object('stale_pricing', jsonb_strip_nulls(jsonb_build_object(
      'products', case when array_length(v_stale_products, 1) > 0
                    then to_jsonb(array(select distinct unnest(v_stale_products))) end,
      'promotions', case when array_length(v_stale_promotions, 1) > 0
                      then to_jsonb(array(select distinct unnest(v_stale_promotions))) end
    )));
  end if;
  -- The client's provisional total is never trusted for money, only compared: the server's total always wins.
  if p_expected_total is not null and round(p_expected_total, v_scale) <> v_total then
    v_sync_issues := v_sync_issues
      || jsonb_build_object('price_mismatch', jsonb_build_object('expected', p_expected_total, 'actual', v_total));
  end if;
  if v_source = 'offline' then
    -- Every offline-sourced sale gets at least one manager glance, even with nothing else off: occurred_at is
    -- client-supplied and reachable through the plain online /sales call too (not only the real offline queue), so
    -- this is the only way to guarantee a human eventually looks at every sale that used the offline leniency
    -- (never-reject-for-stock, price-mismatch-only, the fallbacks above).
    v_sync_issues := v_sync_issues || jsonb_build_object('offline_sale', true);
  end if;

  if p_payments is null then
    v_payments := jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', v_total));
  else
    v_payments := p_payments;
    v_pay_sum := 0;
    for v_pay in select value from jsonb_array_elements(v_payments) as t(value)
    loop
      v_pay_amount := (v_pay ->> 'amount')::numeric;
      v_pay_sum := v_pay_sum + v_pay_amount;
    end loop;
    if v_pay_sum <> v_total then
      if v_source = 'online' then
        raise exception 'Payments do not add up to the total' using errcode = 'P0001';
      end if;
      -- B7 (M4): never drop a payment that can instead be shrunk. Drain the cash leg first when there is one
      -- (minimizes till impact); with no cash leg, drain the LAST payment first, then the first. Only if BOTH
      -- drain targets would still go negative does this collapse to a single payment for the whole total.
      -- `payment_adjusted` logs the complete before/after payment arrays, not just the one scalar touched.
      v_payments_before := v_payments;
      v_first_method := (v_payments -> 0 ->> 'method')::public.payment_method;
      v_adjust_cash_idx := -1;
      for v_pay_index in 0 .. jsonb_array_length(v_payments) - 1 loop
        if (v_payments -> v_pay_index ->> 'method') = 'cash' then
          v_adjust_cash_idx := v_pay_index;
        end if;
      end loop;

      if jsonb_array_length(v_payments) = 1 then
        v_payments := jsonb_set(v_payments, array['0', 'amount'], to_jsonb(v_total));
      else
        if v_adjust_cash_idx >= 0 then
          v_drain0 := v_adjust_cash_idx;
          v_drain1 := case when v_adjust_cash_idx = 0 then 1 else 0 end;
        else
          v_drain0 := jsonb_array_length(v_payments) - 1;
          v_drain1 := 0;
        end if;

        v_amt0 := (v_payments -> v_drain0 ->> 'amount')::numeric;
        v_delta := v_total - v_pay_sum;
        v_new0 := v_amt0 + v_delta;
        if v_new0 > 0 then
          v_payments := jsonb_set(v_payments, array[v_drain0::text, 'amount'], to_jsonb(v_new0));
        else
          v_amt1 := (v_payments -> v_drain1 ->> 'amount')::numeric;
          v_new1 := v_amt1 + v_new0;
          if v_new1 > 0 then
            v_payments := jsonb_build_array(jsonb_build_object(
              'method', (v_payments -> v_drain1 ->> 'method'),
              'amount', v_new1
            ));
          else
            -- Even zeroing both legs is not enough (or overshoots): collapse to one payment for the whole total.
            v_payments := jsonb_build_array(jsonb_build_object('method', v_first_method, 'amount', v_total));
          end if;
        end if;
      end if;
      v_sync_issues := v_sync_issues || jsonb_build_object(
        'payment_adjusted', jsonb_build_object('before', v_payments_before, 'after', v_payments)
      );
    end if;
  end if;

  update public.orders
     set subtotal = v_subtotal, discount = v_discount, tax = v_tax, total = v_total,
         sync_issues = nullif(v_sync_issues, '{}'::jsonb)
   where id = v_order_id;

  for v_pay in select value from jsonb_array_elements(v_payments) as t(value)
  loop
    insert into public.payments (order_id, payment_method, amount, created_by, business_day_id, cash_session_id)
    values (v_order_id, (v_pay ->> 'method')::public.payment_method, (v_pay ->> 'amount')::numeric,
            v_uid, v_business_day_id, v_cash_session_id);
  end loop;

  if p_idempotency_key is not null then
    update public.idempotency_keys
       set result = jsonb_build_object('order_id', v_order_id)
     where key = p_idempotency_key;
  end if;

  return v_order_id;
end;
$$;


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
  -- stock modes
  v_existing       record;
  v_lock_ids       uuid[];
  v_take           record;
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

  -- Lock every stock row these lines touch (presentations resolve to their base) in one global order.
  select array_agg(t.inventory_id) into v_lock_ids
  from jsonb_array_elements(v_expanded) e
  cross join lateral public._stock_target((e ->> 'product_id')::uuid, nullif(e ->> 'variant_id', '')::uuid) t
  where t.inventory_id is not null;
  perform public._lock_inventory(v_lock_ids);

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

    -- A line already on the tab keeps its stock photo (price is not re-read either), so removing or voiding it
    -- later puts everything back in one place. A pre-migration line (units null) is its own product, factor 1.
    select ti.stock_product_id, ti.stock_units into v_existing
    from public.tab_items ti
    where ti.tab_id = p_tab_id
      and ti.product_id = v_item.product_id
      and ti.variant_id is not distinct from v_item.variant_id
      and ti.promotion_id is not distinct from v_promo_id;
    if found then
      select * into v_take
      from public._take_stock(v_item.product_id, v_item.variant_id, v_item.quantity, p_tab_id, v_uid, v_name, false,
                              coalesce(v_existing.stock_product_id,
                                       case when v_existing.stock_units is null then v_item.product_id end),
                              coalesce(v_existing.stock_units, 1));
    else
      select * into v_take
      from public._take_stock(v_item.product_id, v_item.variant_id, v_item.quantity, p_tab_id, v_uid, v_name);
    end if;

    -- Price photo on first add; repeats sum quantity + discount, never re-price.
    insert into public.tab_items (
      tab_id, product_id, variant_id, quantity, unit_price, tax_rate, discount, promotion_id, added_by,
      stock_product_id, stock_units
    )
    values (
      p_tab_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price, v_tax_rate,
      v_line_discount, v_promo_id, v_uid, v_take.stock_product_id, v_take.stock_units
    )
    on conflict (tab_id, product_id, variant_id, promotion_id)
    do update set
      quantity = public.tab_items.quantity + excluded.quantity,
      discount = public.tab_items.discount + excluded.discount,
      updated_at = now();

  end loop;

  update public.tabs set updated_at = now() where id = p_tab_id;
end;
$$;


create or replace function public.tab_remove_item(p_tab_id uuid, p_item_id uuid, p_quantity int, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_reason    text := nullif(btrim(p_reason), '');
  v_status    public.tab_status;
  v_item      public.tab_items%rowtype;
  v_new_total numeric(14, 2);
  v_paid      numeric(14, 2);
  v_inv_id    uuid;
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'A reason is required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Invalid quantity';
  end if;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open';
  end if;

  select * into v_item from public.tab_items where id = p_item_id and tab_id = p_tab_id for update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if p_quantity > v_item.quantity then
    raise exception 'Cannot remove more than what is on the tab';
  end if;

  if p_quantity = v_item.quantity then
    delete from public.tab_items where id = p_item_id;
  else
    update public.tab_items set quantity = quantity - p_quantity, updated_at = now() where id = p_item_id;
  end if;

  -- Recomputed AFTER the removal: if it would leave the tab owing less than what people already paid, the whole
  -- function call (including the delete/update above) rolls back automatically when this raises.
  select total, paid into v_new_total, v_paid from public._tab_totals(p_tab_id);
  if v_new_total < v_paid then
    raise exception 'Removing this would leave the tab owing less than what has already been paid';
  end if;

  perform public._return_stock(v_item.product_id, v_item.variant_id, v_item.stock_product_id, v_item.stock_units,
                               p_quantity * coalesce(nullif(v_item.stock_units, 0), 1), p_tab_id, v_reason, v_uid);

  update public.tabs set updated_at = now() where id = p_tab_id;
end;
$$;


create or replace function public.void_tab(p_tab_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  v_status public.tab_status;
  v_item   record;
  v_inv_id uuid;
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'A reason is required';
  end if;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'Only an open tab can be voided';
  end if;
  if exists (select 1 from public.tab_payments where tab_id = p_tab_id) then
    raise exception 'A tab with payments cannot be voided';
  end if;

  -- Sorted by the row the stock goes back to (the base for a presentation), same global order as _lock_inventory.
  for v_item in
    select product_id, variant_id, quantity, stock_product_id, stock_units
    from public.tab_items where tab_id = p_tab_id
    order by case when stock_units is null then product_id else stock_product_id end nulls last,
             variant_id nulls first
  loop
    perform public._return_stock(v_item.product_id, v_item.variant_id, v_item.stock_product_id, v_item.stock_units,
                                 v_item.quantity * coalesce(nullif(v_item.stock_units, 0), 1), p_tab_id, v_reason,
                                 v_uid);
  end loop;

  update public.tabs
     set status = 'voided', voided_by = v_uid, voided_at = now(), void_reason = v_reason, updated_at = now()
   where id = p_tab_id;
end;
$$;


create or replace function public._create_order_from_tab(
  p_tab_id uuid,
  p_status public.order_status,
  p_debtor_name text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_scale    int;
  v_tab      record;
  v_totals   record;
  v_order_id uuid;
  v_business_day_id uuid;
  v_cash_session_id uuid;
  v_current_status  text;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_scale := public.money_scale();
  perform public._auto_close_stale_business_days();
  select a.business_day_id, a.cash_session_id
    into v_business_day_id, v_cash_session_id
    from public._current_assignment(v_uid, now()) a;
  if v_cash_session_id is not null then
    select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
    if v_current_status is distinct from 'open' then
      v_cash_session_id := null;
    end if;
  end if;
  select * into v_tab from public.tabs where id = p_tab_id;
  select * into v_totals from public._tab_totals(p_tab_id);

  insert into public.orders (
    order_number, customer_id, status, tab_id, created_by, subtotal, discount, tax, total,
    business_day_id, cash_session_id, settled_at, debtor_name
  )
  values (
    'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
    v_tab.customer_id, p_status, p_tab_id, v_uid,
    v_totals.subtotal, v_totals.discount, v_totals.tax, v_totals.total,
    v_business_day_id, v_cash_session_id,
    case when p_status = 'completed' then now() else null end,
    nullif(btrim(p_debtor_name), '')
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, variant_id, quantity, unit_price, discount, tax, total, tax_rate, promotion_id, unit_cost,
    stock_product_id, stock_units
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
    ti.promotion_id,
    (select coalesce(v.cost_price, p.cost_price) from public.products p
       left join public.product_variants v on v.id = ti.variant_id
      where p.id = ti.product_id),
    ti.stock_product_id,
    ti.stock_units
  from public.tab_items ti
  where ti.tab_id = p_tab_id;

  insert into public.payments (order_id, payment_method, amount, created_by, business_day_id, cash_session_id)
  select
    v_order_id,
    tp.payment_method,
    tp.amount,
    tp.created_by,
    coalesce((select cs.business_day_id from public.cash_sessions cs where cs.id = tp.cash_session_id), v_business_day_id),
    tp.cash_session_id
  from public.tab_payments tp
  where tp.tab_id = p_tab_id;

  update public.tabs
     set status = 'closed', order_id = v_order_id, closed_by = v_uid, closed_at = now(), updated_at = now()
   where id = p_tab_id;

  return v_order_id;
end;
$$;


revoke all on function public._create_order_from_tab(uuid, public.order_status, text) from public, anon, authenticated;


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
  v_original_session uuid;
  v_session_status   text;
  v_refund_session    uuid;
  v_refund_after_close boolean := false;
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
  if v_status = 'pending' then
    raise exception 'Pending receivables cannot be refunded' using errcode = 'P0001';
  end if;
  if v_status <> 'completed' then
    raise exception 'Only completed orders can be refunded';
  end if;

  select p.cash_session_id into v_original_session
  from public.payments p
  where p.order_id = p_order_id and p.payment_method = 'cash'
  limit 1;

  if v_original_session is not null then
    select status into v_session_status from public.cash_sessions where id = v_original_session for share;
    if v_session_status = 'open' then
      v_refund_session := v_original_session;
    else
      v_refund_after_close := true;
    end if;
  end if;

  update public.orders
     set status = 'refunded', refunded_at = now(), refunded_by = v_uid, refund_reason = v_reason,
         refund_cash_session_id = v_refund_session,
         refund_after_close = v_refund_after_close
   where id = p_order_id;

  -- Stock goes back where the sale took it (the line's photo), in the same global order as _lock_inventory.
  for v_item in
    select product_id, variant_id, stock_product_id, stock_units,
           coalesce(stock_taken, quantity * coalesce(nullif(stock_units, 0), 1)) as base_qty
    from public.order_items
    where order_id = p_order_id
    order by case when stock_units is null then product_id else stock_product_id end nulls last,
             variant_id nulls first
  loop
    perform public._return_stock(v_item.product_id, v_item.variant_id, v_item.stock_product_id, v_item.stock_units,
                                 v_item.base_qty, p_order_id, v_reason, v_uid);
  end loop;
end;
$$;


create or replace function public.receive_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_invoice text,
  p_notes text,
  p_cash_session_id uuid,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_scale     int := public.money_scale();
  v_day       uuid;
  v_status    text;
  v_id        uuid;
  v_total     numeric(14, 2) := 0;
  v_entry     jsonb;
  v_product   uuid;
  v_qty       int;
  v_cost      numeric(14, 2);
  v_inv_id    uuid;
  v_invoice   text := nullif(btrim(coalesce(p_invoice, '')), '');
  v_notes     text := nullif(btrim(coalesce(p_notes, '')), '');
  v_po_number text;
  v_target    record;
  v_lock_ids  uuid[];
  v_request_hash     text;
  v_existing_user     uuid;
  v_existing_hash     text;
  v_existing_result   jsonb;
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_supplier_id is null or not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id and s.deleted_at is null
  ) then
    raise exception 'Supplier not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'Items must be an array of 1 to 100 lines' using errcode = 'P0001';
  end if;

  for v_entry in select value from jsonb_array_elements(p_items) as t(value)
  loop
    begin
      v_product := (v_entry ->> 'product_id')::uuid;
    exception when others then
      raise exception 'Invalid product_id' using errcode = 'P0001';
    end;
    v_qty := (v_entry ->> 'quantity')::int;
    v_cost := (v_entry ->> 'unit_cost')::numeric;
    if v_product is null or v_qty is null or v_qty <= 0 then
      raise exception 'Each line needs a product and a positive quantity' using errcode = 'P0001';
    end if;
    if v_cost is null or v_cost < 0 then
      raise exception 'Unit cost must be zero or positive' using errcode = 'P0001';
    end if;
    if v_cost <> round(v_cost, v_scale) then
      raise exception 'Too many decimal places' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.products where id = v_product and stock_mode = 'none') then
      raise exception 'This product does not track stock' using errcode = 'P0001';
    end if;
    v_total := v_total + (v_qty * v_cost);
  end loop;

  if p_idempotency_key is not null then
    v_request_hash := md5(p_supplier_id::text || '|' || p_items::text || '|' || coalesce(v_invoice, ''));

    insert into public.idempotency_keys (key, user_id, action, request_hash)
    values (p_idempotency_key, v_uid, 'receive_purchase', v_request_hash)
    on conflict (key) do nothing;

    if not found then
      select user_id, request_hash, result
        into v_existing_user, v_existing_hash, v_existing_result
      from public.idempotency_keys
      where key = p_idempotency_key;

      if v_existing_user is not distinct from v_uid and v_existing_hash is not distinct from v_request_hash
         and v_existing_result is not null then
        return (v_existing_result ->> 'purchase_order_id')::uuid;
      end if;
      raise exception 'This purchase was already submitted, refresh and try again' using errcode = 'BS409';
    end if;
  end if;

  if p_cash_session_id is not null then
    select status, business_day_id into v_status, v_day
    from public.cash_sessions
    where id = p_cash_session_id
    for update;
    if not found then
      raise exception 'Cash session not found' using errcode = 'P0002';
    end if;
    if v_status <> 'open' then
      raise exception 'Cash session is closed' using errcode = 'P0001';
    end if;
  end if;

  v_po_number := 'PO-' || to_char(now(), 'YYMMDD') || '-'
    || lpad(nextval('public.purchase_order_number_seq')::text, 6, '0');

  insert into public.purchase_orders (
    po_number, supplier_id, status, total_amount, notes, invoice_number,
    ordered_by, received_by, ordered_at, received_at,
    business_day_id, cash_session_id
  ) values (
    v_po_number, p_supplier_id, 'received', round(v_total, 2), v_notes, v_invoice,
    v_uid, v_uid, now(), now(),
    v_day, p_cash_session_id
  )
  returning id into v_id;

  -- Lock every stock row (a presentation resolves to its base) in the same global order as create_sale.
  select array_agg(t.inventory_id) into v_lock_ids
  from jsonb_array_elements(p_items) e
  cross join lateral public._stock_target((e ->> 'product_id')::uuid) t
  where t.inventory_id is not null;
  perform public._lock_inventory(v_lock_ids);

  for v_entry in
    select value from jsonb_array_elements(p_items) as t(value)
    order by (value ->> 'product_id')
  loop
    v_product := (v_entry ->> 'product_id')::uuid;
    v_qty := (v_entry ->> 'quantity')::int;
    v_cost := round((v_entry ->> 'unit_cost')::numeric, 2);

    -- Buying 2 boxes of a presentation × 15 puts 30 units on its base; the movement records the cost per base unit.
    select * into v_target from public._stock_target(v_product);
    v_inv_id := v_target.inventory_id;
    if v_inv_id is null then
      raise exception 'Inventory row not found for product' using errcode = 'P0001';
    end if;

    insert into public.purchase_order_items (
      purchase_order_id, product_id, quantity, unit_price, stock_product_id, stock_units
    ) values (v_id, v_product, v_qty, v_cost, v_target.stock_product_id, v_target.units);

    update public.inventory
       set quantity = quantity + v_qty * v_target.units,
           last_restocked_at = now()
     where id = v_inv_id;

    insert into public.inventory_transactions (
      inventory_id, transaction_type, quantity, reference_id,
      supplier_id, unit_cost, created_by
    ) values (
      v_inv_id, 'purchase', v_qty * v_target.units, v_id,
      p_supplier_id, round(v_cost / v_target.units, 2), v_uid
    );
  end loop;

  if p_idempotency_key is not null then
    update public.idempotency_keys
       set result = jsonb_build_object('purchase_order_id', v_id)
     where key = p_idempotency_key;
  end if;

  return v_id;
end;
$$;


revoke all on function public.receive_purchase(uuid, jsonb, text, text, uuid, uuid) from public, anon;
grant execute on function public.receive_purchase(uuid, jsonb, text, text, uuid, uuid) to authenticated;


create or replace function public.void_purchase(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status   public.po_status;
  v_supplier uuid;
  v_item     record;
  v_inv_id   uuid;
  v_qty      int;
  v_cash_session_id uuid;
  v_session_status  text;
begin
  if v_uid is null or not public.has_min_role('admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A reason is required' using errcode = 'P0001';
  end if;

  select status, supplier_id, cash_session_id into v_status, v_supplier, v_cash_session_id
  from public.purchase_orders
  where id = p_id
  for update;
  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status is distinct from 'received' then
    raise exception 'Purchase is not received' using errcode = 'P0001';
  end if;
  if v_cash_session_id is not null then
    select status into v_session_status from public.cash_sessions where id = v_cash_session_id;
  end if;

  -- Check every stock row (summed, in base units: a presentation's line counts quantity × units on its base)
  -- before changing anything. Sorted in the same global order as _lock_inventory.
  for v_item in
    select coalesce(stock_product_id, product_id) as product_id,
           sum(quantity * coalesce(stock_units, 1))::int as quantity
    from public.purchase_order_items
    where purchase_order_id = p_id
    group by 1
    order by 1
  loop
    select id, quantity into v_inv_id, v_qty
    from public.inventory
    where product_id = v_item.product_id and variant_id is null
    for update;
    if not found then
      raise exception 'Inventory row not found for product' using errcode = 'P0001';
    end if;
    if v_qty < v_item.quantity then
      raise exception 'Insufficient stock to void purchase' using errcode = 'P0001';
    end if;
  end loop;

  for v_item in
    select coalesce(stock_product_id, product_id) as product_id,
           quantity * coalesce(stock_units, 1) as quantity,
           round(unit_price / coalesce(stock_units, 1), 2) as unit_price
    from public.purchase_order_items
    where purchase_order_id = p_id
    order by 1
  loop
    select id into v_inv_id
    from public.inventory
    where product_id = v_item.product_id and variant_id is null
    for update;

    update public.inventory
       set quantity = quantity - v_item.quantity
     where id = v_inv_id;

    insert into public.inventory_transactions (
      inventory_id, transaction_type, quantity, reference_id,
      supplier_id, unit_cost, notes, created_by
    ) values (
      v_inv_id, 'purchase', -v_item.quantity, p_id,
      v_supplier, v_item.unit_price, v_reason, v_uid
    );
  end loop;

  update public.purchase_orders
     set status = 'cancelled',
         voided_after_close = coalesce(v_session_status = 'closed', false)
   where id = p_id;
end;
$$;


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
    select ord.id, ord.total, (ord.settled_at at time zone v_tz)::date as day
    from public.orders ord
    where ord.status = 'completed'
      and ord.settled_at >= (least(v_month, v_today - 29))::timestamp at time zone v_tz
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
      where i.variant_id is null and p.is_active and p.deleted_at is null and p.stock_mode = 'own'
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
        where i.variant_id is null and p.is_active and p.deleted_at is null and p.stock_mode = 'own'
          and i.quantity <= i.low_stock_threshold
        order by i.quantity, p.name
        limit 5) t),
    'receivables_total', (
      select coalesce(sum(
        ord.total - coalesce((select sum(p.amount) from public.payments p where p.order_id = ord.id), 0)
      ), 0)
      from public.orders ord
      where ord.status = 'pending'
    ),
    'receivables_overdue', (
      select coalesce(sum(
        ord.total - coalesce((select sum(p.amount) from public.payments p where p.order_id = ord.id), 0)
      ), 0)
      from public.orders ord
      where ord.status = 'pending'
        and ord.due_date is not null
        and ord.due_date < v_today
    )
  ) into v_result;

  return v_result;
end;
$$;


drop function public.top_selling_products(int, int);


create function public.top_selling_products(p_days int default 30, p_limit int default 5)
returns table (
  product_id     uuid,
  name           text,
  selling_price  numeric,
  stock          int,
  category_name  text,
  quantity       bigint,
  stock_mode     text,
  stock_product_id uuid,
  stock_units    int,
  stock_base_quantity int
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
      case p.stock_mode when 'none' then null else i.quantity / p.stock_units end as stock,
      c.name as category_name,
      sum(oi.quantity)::bigint as quantity,
      p.stock_mode,
      p.stock_product_id,
      p.stock_units,
      case p.stock_mode when 'none' then null else i.quantity end as stock_base_quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    left join public.inventory i on i.product_id = coalesce(p.stock_product_id, p.id) and i.variant_id is null
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
