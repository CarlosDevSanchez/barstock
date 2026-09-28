-- R-B: cash/business-day money and concurrency fixes (M1, M2, M7, M8, M9, R-1, R-2).
-- B9 (M3, legacy pending orders) is a separate migration (20261006000003) pending the read-only count
-- from the real project (plan §2); it is NOT included here.

-- B1 (M1): the assignment must hold at p_at, not "whichever session happens to be open right now".
create or replace function public._current_assignment(p_user uuid, p_at timestamptz)
returns table (business_day_id uuid, cash_session_id uuid)
language sql stable security definer set search_path = ''
as $$
  select
    (
      select bd.id from public.business_days bd
      where bd.opened_at <= p_at and (bd.closed_at is null or bd.closed_at > p_at)
      order by bd.opened_at desc
      limit 1
    ),
    (
      select cs.id from public.cash_sessions cs
      join public.cash_session_users csu on csu.session_id = cs.id
      where csu.user_id = p_user
        and cs.opened_at <= p_at and (cs.closed_at is null or cs.closed_at > p_at)
      order by cs.opened_at desc
      limit 1
    );
$$;

-- B4 (M8): lock the business day BEFORE closing its cash sessions, so a concurrent open_cash_session
-- (which locks the same row) either sees it already closed or finishes opening before we tear it down.
create or replace function public.close_business_day(p_id uuid, p_notes text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_open boolean;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.business_days where id = p_id and closed_at is null for update
  ) then
    raise exception 'Business day not found' using errcode = 'P0002';
  end if;
  v_open := exists (
    select 1 from public.cash_sessions where business_day_id = p_id and status = 'open'
  );
  -- B4/B2: this statement can now run right after waiting on the business_days lock, by which point a session
  -- opened by the transaction that raced us in (and won) may have a real opened_at slightly AFTER our own
  -- transaction's frozen now() (Postgres freezes now() at transaction start, not at statement time). greatest()
  -- keeps closed_at valid against `cash_sessions_closed_after_open`, the same guard _auto_close_stale_business_days
  -- already uses for the same reason.
  update public.cash_sessions cs
     set status = 'closed',
         closed_at = greatest(now(), cs.opened_at + interval '1 millisecond'),
         closed_by = v_uid,
         needs_review = true,
         counted_cash = null,
         expected_cash = (public._session_cash(cs.id) ->> 'expected_cash')::numeric,
         difference = null
   where cs.business_day_id = p_id and cs.status = 'open';
  update public.business_days
     set closed_at = now(),
         closed_by = v_uid,
         close_kind = 'manual',
         needs_review = v_open,
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_id;
end;
$$;

-- B5 (M10): reject a future close, reject an overlap with another business day, and reassign expenses,
-- purchase_orders and cash_sessions too (previously only orders/payments moved); payments now follow their
-- order's settlement time, not payments.created_at (which is the sync time for offline sales).
create or replace function public.adjust_business_day(
  p_id uuid,
  p_opened_at timestamptz,
  p_closed_at timestamptz,
  p_notes text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_min_role('admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_opened_at is null or (p_closed_at is not null and p_closed_at <= p_opened_at) then
    raise exception 'The close must be after the open' using errcode = 'P0001';
  end if;
  if p_closed_at is not null and p_closed_at > now() then
    raise exception 'The close cannot be in the future' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.business_days where id = p_id) then
    raise exception 'Business day not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.business_days bd
    where bd.id <> p_id
      and bd.opened_at < coalesce(p_closed_at, 'infinity'::timestamptz)
      and coalesce(bd.closed_at, 'infinity'::timestamptz) > p_opened_at
  ) then
    raise exception 'This range overlaps another business day' using errcode = 'P0001';
  end if;
  begin
    update public.business_days
       set opened_at = p_opened_at,
           closed_at = p_closed_at,
           notes = nullif(btrim(p_notes), ''),
           needs_review = false,
           reviewed_by = v_uid,
           reviewed_at = now()
     where id = p_id;
  exception
    when unique_violation then
      raise exception 'A business day is already open' using errcode = 'P0001';
    when check_violation then
      raise exception 'The close must be after the open' using errcode = 'P0001';
  end;

  -- Rows on this day, and rows whose timestamp now falls in the new range, follow the day that contains them.
  update public.orders o
     set business_day_id = (
       select bd.id from public.business_days bd
       where bd.opened_at <= coalesce(o.occurred_at, o.created_at)
         and (bd.closed_at is null or bd.closed_at > coalesce(o.occurred_at, o.created_at))
       order by bd.opened_at desc
       limit 1
     )
   where o.business_day_id = p_id
      or (coalesce(o.occurred_at, o.created_at) >= p_opened_at
          and (p_closed_at is null or coalesce(o.occurred_at, o.created_at) < p_closed_at));

  -- Payments follow their order's settlement time (occurred_at/settled_at), not payments.created_at, which
  -- for an offline sale is the sync time and can land in a completely different business day than the sale.
  update public.payments p
     set business_day_id = (
       select bd.id from public.business_days bd
       where bd.opened_at <= coalesce(o.settled_at, o.occurred_at, o.created_at)
         and (bd.closed_at is null or bd.closed_at > coalesce(o.settled_at, o.occurred_at, o.created_at))
       order by bd.opened_at desc
       limit 1
     )
    from public.orders o
   where p.order_id = o.id
     and (
       p.business_day_id = p_id
       or (coalesce(o.settled_at, o.occurred_at, o.created_at) >= p_opened_at
           and (p_closed_at is null or coalesce(o.settled_at, o.occurred_at, o.created_at) < p_closed_at))
     );

  update public.expenses e
     set business_day_id = (
       select bd.id from public.business_days bd
       where bd.opened_at <= e.occurred_at
         and (bd.closed_at is null or bd.closed_at > e.occurred_at)
       order by bd.opened_at desc
       limit 1
     )
   where e.business_day_id = p_id
      or (e.occurred_at >= p_opened_at and (p_closed_at is null or e.occurred_at < p_closed_at));

  update public.purchase_orders po
     set business_day_id = (
       select bd.id from public.business_days bd
       where bd.opened_at <= po.received_at
         and (bd.closed_at is null or bd.closed_at > po.received_at)
       order by bd.opened_at desc
       limit 1
     )
   where po.business_day_id = p_id
      or (po.received_at >= p_opened_at and (p_closed_at is null or po.received_at < p_closed_at));

  -- cash_sessions.business_day_id is NOT NULL (unlike orders/payments/expenses/purchase_orders): if the move
  -- leaves a session outside every day's range, it stays on the day being adjusted rather than violating that
  -- constraint or silently picking an unrelated day.
  update public.cash_sessions cs
     set business_day_id = coalesce((
       select bd.id from public.business_days bd
       where bd.opened_at <= cs.opened_at
         and (bd.closed_at is null or bd.closed_at > cs.opened_at)
       order by bd.opened_at desc
       limit 1
     ), p_id)
   where cs.business_day_id = p_id
      or (cs.opened_at >= p_opened_at and (p_closed_at is null or cs.opened_at < p_closed_at));
end;
$$;

-- B3 (M2): a refund is subtracted from the till it is refunded FROM, not the till the original sale happened
-- to be paid in (which may be closed, or a different register entirely for an old/offline sale).
alter table public.orders
  add column if not exists refund_cash_session_id uuid references public.cash_sessions (id);

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
  v_had_cash boolean;
  v_refund_session uuid;
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

  select exists (
    select 1 from public.payments where order_id = p_order_id and payment_method = 'cash'
  ) into v_had_cash;
  if v_had_cash then
    select a.cash_session_id into v_refund_session from public._current_assignment(v_uid, now()) a;
  end if;

  update public.orders
     set status = 'refunded', refunded_at = now(), refunded_by = v_uid, refund_reason = v_reason,
         refund_cash_session_id = v_refund_session
   where id = p_order_id;

  for v_item in
    select product_id, variant_id, coalesce(stock_taken, quantity) as quantity
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

-- B6 (M7, R-2): voiding a cash expense/purchase after its till has closed must NOT change what was already
-- reconciled. `voided_after_close` records that the void happened post-close; `_session_cash` then keeps
-- treating the row as still deducted for that (closed) session, exactly as it was when the till was counted.
alter table public.expenses
  add column if not exists voided_after_close boolean not null default false;
alter table public.purchase_orders
  add column if not exists voided_after_close boolean not null default false;

create or replace function public.void_expense(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cash_session_id uuid;
  v_session_status text;
begin
  if v_uid is null or not public.has_min_role('admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required' using errcode = 'P0001';
  end if;
  select cash_session_id into v_cash_session_id from public.expenses where id = p_id;
  if not found then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
  if v_cash_session_id is not null then
    select status into v_session_status from public.cash_sessions where id = v_cash_session_id;
  end if;
  update public.expenses
     set deleted_at = now(),
         void_reason = btrim(p_reason),
         voided_after_close = coalesce(v_session_status = 'closed', false)
   where id = p_id and deleted_at is null;
  if not found then
    raise exception 'Expense is already voided' using errcode = 'P0001';
  end if;
end;
$$;

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

  -- Check every product (summed) before changing anything.
  for v_item in
    select product_id, sum(quantity)::int as quantity
    from public.purchase_order_items
    where purchase_order_id = p_id
    group by product_id
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
    select product_id, quantity, unit_price
    from public.purchase_order_items
    where purchase_order_id = p_id
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

-- _session_cash: a row voided after its till closed (voided_after_close) stays counted as if it were still
-- active, so a later void never changes a figure that was already reconciled and signed off on.
create or replace function public._session_cash(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_float       numeric(14, 2);
  v_cash_sales  numeric(14, 2);
  v_open_tab    numeric(14, 2);
  v_deposits    numeric(14, 2);
  v_withdrawals numeric(14, 2);
  v_refunded    numeric(14, 2);
  v_expenses    numeric(14, 2);
  v_purchases   numeric(14, 2);
begin
  select opening_float into v_float from public.cash_sessions where id = p_session_id;
  if not found then
    return null;
  end if;

  select coalesce(sum(amount), 0) into v_cash_sales
  from public.payments
  where cash_session_id = p_session_id and payment_method = 'cash';

  select coalesce(sum(tp.amount), 0) into v_open_tab
  from public.tab_payments tp
  where tp.cash_session_id = p_session_id
    and tp.payment_method = 'cash'
    and not exists (select 1 from public.orders o where o.tab_id = tp.tab_id);

  select coalesce(sum(amount), 0) into v_deposits
  from public.cash_movements where session_id = p_session_id and kind = 'deposit';
  select coalesce(sum(amount), 0) into v_withdrawals
  from public.cash_movements where session_id = p_session_id and kind = 'withdrawal';

  -- B3 (M2): only the cash portion of the order is put back, and it comes out of the session it was
  -- refunded FROM (refund_cash_session_id), never the original payment's session.
  select coalesce(sum(p.amount), 0) into v_refunded
  from public.payments p
  join public.orders o on o.id = p.order_id
  where o.refund_cash_session_id = p_session_id and p.payment_method = 'cash' and o.status = 'refunded';

  select coalesce(sum(e.amount), 0) into v_expenses
  from public.expenses e
  where e.cash_session_id = p_session_id
    and e.payment_method = 'cash'
    and (e.deleted_at is null or e.voided_after_close);

  select coalesce(sum(po.total_amount), 0) into v_purchases
  from public.purchase_orders po
  where po.cash_session_id = p_session_id
    and (po.status = 'received' or po.voided_after_close);

  return jsonb_build_object(
    'opening_float', v_float,
    'cash_sales', v_cash_sales,
    'open_tab_cash', v_open_tab,
    'deposits', v_deposits,
    'withdrawals', v_withdrawals,
    'refunded_cash', v_refunded,
    'expenses', v_expenses,
    'purchases', v_purchases,
    'expected_cash', v_float + v_cash_sales + v_open_tab + v_deposits
      - v_withdrawals - v_refunded - v_expenses - v_purchases
  );
end;
$$;

-- B2 (M9) + B7 (M4): create_sale, copied verbatim from its current definition and patched at three points:
--   1. reject two payments with the same method (matches pay_receivable's existing rule);
--   2. after _current_assignment, re-check under lock that the assigned cash session is still open;
--   3. the offline payment-adjustment fallback never drops a non-cash payment.
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
  v_adjust_other_idx int;
  v_adjust_other_amt numeric(14, 2);
  v_adjust_remainder numeric(14, 2);
  v_first_method     public.payment_method;
  v_current_status   text;
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

    if v_source = 'offline' then
      -- The money already changed hands: never reject for stock. Take what is there (down to 0, the CHECK still
      -- holds) and record the rest as a shortfall for a manager to reconcile.
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
      v_taken := v_item.quantity;
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
                                    tax_rate, promotion_id, stock_taken, unit_cost)
    values (v_order_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price,
            v_line_discount, v_line_tax, v_line_base + v_line_tax, v_tax_rate, v_promo_id, v_taken,
            (select p.cost_price from public.products p where p.id = v_item.product_id));

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
      -- B7 (M4): a non-cash payment (already charged to a card/ewallet) must never be dropped. Shrink the
      -- cash leg first, down to 0; only once that is exhausted does the remainder come off the other payment.
      v_first_method := (v_payments -> 0 ->> 'method')::public.payment_method;
      v_adjust_cash_idx := -1;
      v_adjust_other_idx := -1;
      for v_pay_index in 0 .. jsonb_array_length(v_payments) - 1 loop
        if (v_payments -> v_pay_index ->> 'method') = 'cash' then
          v_adjust_cash_idx := v_pay_index;
        else
          v_adjust_other_idx := v_pay_index;
        end if;
      end loop;

      if v_adjust_cash_idx >= 0 then
        v_adjust_before := (v_payments -> v_adjust_cash_idx ->> 'amount')::numeric;
        v_adjust_after := v_adjust_before + (v_total - v_pay_sum);
        if v_adjust_after > 0 then
          v_payments := jsonb_set(v_payments, array[v_adjust_cash_idx::text, 'amount'], to_jsonb(v_adjust_after));
          v_sync_issues := v_sync_issues || jsonb_build_object(
            'payment_adjusted', jsonb_build_object('before', v_adjust_before, 'after', v_adjust_after)
          );
        elsif v_adjust_other_idx >= 0 then
          v_adjust_remainder := v_adjust_after; -- <= 0: still owed after the cash leg hit 0
          v_adjust_other_amt := (v_payments -> v_adjust_other_idx ->> 'amount')::numeric;
          if v_adjust_other_amt + v_adjust_remainder > 0 then
            v_payments := jsonb_build_array(jsonb_build_object(
              'method', (v_payments -> v_adjust_other_idx ->> 'method'),
              'amount', v_adjust_other_amt + v_adjust_remainder
            ));
          else
            -- Even zeroing both legs is not enough (or overshoots): collapse to one payment for the whole total.
            v_payments := jsonb_build_array(jsonb_build_object('method', v_first_method, 'amount', v_total));
          end if;
          v_sync_issues := v_sync_issues || jsonb_build_object(
            'payment_adjusted', jsonb_build_object('before', v_adjust_before, 'after', v_total)
          );
        else
          -- Only a cash payment existed; nothing to shift the remainder onto.
          v_payments := jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', v_total));
          v_sync_issues := v_sync_issues || jsonb_build_object(
            'payment_adjusted', jsonb_build_object('before', v_adjust_before, 'after', v_total)
          );
        end if;
      else
        -- No cash leg at all: this has no till implication, so a single-payment collapse is enough.
        v_adjust_before := (v_payments -> v_adjust_other_idx ->> 'amount')::numeric;
        v_adjust_after := v_adjust_before + (v_total - v_pay_sum);
        if v_adjust_after <= 0 then
          v_payments := jsonb_build_array(jsonb_build_object('method', v_first_method, 'amount', v_total));
        else
          v_payments := jsonb_set(v_payments, array[v_adjust_other_idx::text, 'amount'], to_jsonb(v_adjust_after));
        end if;
        v_sync_issues := v_sync_issues || jsonb_build_object(
          'payment_adjusted', jsonb_build_object('before', v_adjust_before, 'after', v_adjust_after)
        );
      end if;
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


-- B2 (M9): _create_order_from_tab (closing a tab / receivable) gets the same lock-and-recheck as create_sale.
create or replace function public._create_order_from_tab(p_tab_id uuid, p_status public.order_status)
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
  v_business_day_id uuid;
  v_cash_session_id uuid;
  v_current_status  text;
begin
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
    business_day_id, cash_session_id, settled_at
  )
  values (
    'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
    v_tab.customer_id, p_status, p_tab_id, v_uid,
    v_totals.subtotal, v_totals.discount, v_totals.tax, v_totals.total,
    v_business_day_id, v_cash_session_id,
    case when p_status = 'completed' then now() else null end
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, variant_id, quantity, unit_price, discount, tax, total, tax_rate, promotion_id, unit_cost
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
    (select p.cost_price from public.products p where p.id = ti.product_id)
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

-- B2 (M9): tab_pay and tab_pay_split get the same lock-and-recheck before recording a tab payment against a
-- cash session (they only touch tab_payments.cash_session_id; the order itself is created later by
-- _create_order_from_tab above, which re-checks again at that point).
create or replace function public.tab_pay(p_tab_id uuid, p_member_id uuid, p_method public.payment_method, p_amount numeric)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_scale   int := public.money_scale();
  v_status  public.tab_status;
  v_balance numeric(14, 2);
  v_cash_session_id uuid;
  v_current_status  text;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform public._auto_close_stale_business_days();
  select a.cash_session_id into v_cash_session_id
    from public._current_assignment(v_uid, now()) a;
  if v_cash_session_id is not null then
    select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
    if v_current_status is distinct from 'open' then
      v_cash_session_id := null;
    end if;
  end if;
  if p_method is null then
    raise exception 'A payment method is required';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, v_scale) then
    raise exception 'Invalid amount';
  end if;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open';
  end if;

  if p_member_id is not null
     and not exists (select 1 from public.tab_members where id = p_member_id and tab_id = p_tab_id) then
    raise exception 'That person is not on this tab';
  end if;

  select balance into v_balance from public._tab_totals(p_tab_id);
  if p_amount > v_balance then
    raise exception 'The amount exceeds the balance';
  end if;

  insert into public.tab_payments (tab_id, member_id, payment_method, amount, created_by, cash_session_id)
  values (p_tab_id, p_member_id, p_method, p_amount, v_uid, v_cash_session_id);

  select balance into v_balance from public._tab_totals(p_tab_id);
  if v_balance <= 0 then
    perform public._close_tab(p_tab_id);
  else
    update public.tabs set updated_at = now() where id = p_tab_id;
  end if;
end;
$$;

create or replace function public.tab_pay_split(p_tab_id uuid, p_member_id uuid, p_payments jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_scale   int := public.money_scale();
  v_status  public.tab_status;
  v_balance numeric(14, 2);
  v_pay     jsonb;
  v_count   int;
  v_sum     numeric(14, 2) := 0;
  v_amount  numeric(14, 2);
  v_method  public.payment_method;
  v_cash_session_id uuid;
  v_current_status  text;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform public._auto_close_stale_business_days();
  select a.cash_session_id into v_cash_session_id
    from public._current_assignment(v_uid, now()) a;
  if v_cash_session_id is not null then
    select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
    if v_current_status is distinct from 'open' then
      v_cash_session_id := null;
    end if;
  end if;
  if jsonb_typeof(p_payments) is distinct from 'array' then
    raise exception 'Invalid payments' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_payments);
  if v_count < 1 or v_count > 2 then
    raise exception 'Invalid payments' using errcode = 'P0001';
  end if;

  for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
  loop
    if (v_pay ->> 'method') is null or (v_pay ->> 'method') not in ('cash', 'card', 'ewallet') then
      raise exception 'Invalid payment method' using errcode = 'P0001';
    end if;
    v_method := (v_pay ->> 'method')::public.payment_method;
    v_amount := (v_pay ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, v_scale) then
      raise exception 'Invalid amount' using errcode = 'P0001';
    end if;
    v_sum := v_sum + v_amount;
  end loop;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open';
  end if;

  if p_member_id is not null
     and not exists (select 1 from public.tab_members where id = p_member_id and tab_id = p_tab_id) then
    raise exception 'That person is not on this tab';
  end if;

  select balance into v_balance from public._tab_totals(p_tab_id);
  if v_sum > v_balance then
    raise exception 'The amount exceeds the balance' using errcode = 'P0001';
  end if;

  for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
  loop
    insert into public.tab_payments (tab_id, member_id, payment_method, amount, created_by, cash_session_id)
    values (
      p_tab_id,
      p_member_id,
      (v_pay ->> 'method')::public.payment_method,
      (v_pay ->> 'amount')::numeric,
      v_uid,
      v_cash_session_id
    );
  end loop;

  select balance into v_balance from public._tab_totals(p_tab_id);
  if v_balance <= 0 then
    perform public._close_tab(p_tab_id);
  else
    update public.tabs set updated_at = now() where id = p_tab_id;
  end if;
end;
$$;

-- B2 (M9): pay_receivable gets the same lock-and-recheck.
create or replace function public.pay_receivable(
  p_order_id uuid,
  p_payments jsonb,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_scale        int := public.money_scale();
  v_status       public.order_status;
  v_total        numeric(14, 2);
  v_paid         numeric(14, 2);
  v_balance      numeric(14, 2);
  v_pay          jsonb;
  v_pay_count    int;
  v_pay_sum      numeric(14, 2) := 0;
  v_pay_amount   numeric(14, 2);
  v_pay_method   public.payment_method;
  v_methods      text[] := '{}';
  v_request_hash text;
  v_existing_user uuid;
  v_existing_hash text;
  v_existing_result jsonb;
  v_business_day_id uuid;
  v_cash_session_id uuid;
  v_result       jsonb;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payments) is distinct from 'array' then
    raise exception 'Invalid payments' using errcode = 'P0001';
  end if;
  v_pay_count := jsonb_array_length(p_payments);
  if v_pay_count < 1 or v_pay_count > 2 then
    raise exception 'Invalid payments' using errcode = 'P0001';
  end if;

  for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
  loop
    if (v_pay ->> 'method') is null
       or (v_pay ->> 'method') not in ('cash', 'card', 'ewallet') then
      raise exception 'Invalid payment method' using errcode = 'P0001';
    end if;
    v_pay_method := (v_pay ->> 'method')::public.payment_method;
    if v_pay_method::text = any (v_methods) then
      raise exception 'Payment methods must be distinct' using errcode = 'P0001';
    end if;
    v_methods := array_append(v_methods, v_pay_method::text);
    v_pay_amount := (v_pay ->> 'amount')::numeric;
    if v_pay_amount is null or v_pay_amount <= 0 or v_pay_amount <> round(v_pay_amount, v_scale) then
      raise exception 'Invalid amount' using errcode = 'P0001';
    end if;
    v_pay_sum := v_pay_sum + v_pay_amount;
  end loop;

  if p_idempotency_key is not null then
    v_request_hash := md5(p_order_id::text || '|' || p_payments::text);

    insert into public.idempotency_keys (key, user_id, action, request_hash)
    values (p_idempotency_key, v_uid, 'pay_receivable', v_request_hash)
    on conflict (key) do nothing;

    if not found then
      select user_id, request_hash, result
        into v_existing_user, v_existing_hash, v_existing_result
      from public.idempotency_keys
      where key = p_idempotency_key;

      if v_existing_user is not distinct from v_uid and v_existing_hash is not distinct from v_request_hash
         and v_existing_result is not null then
        return v_existing_result;
      end if;
      raise exception 'This sale was already submitted, refresh and try again' using errcode = 'BS409';
    end if;
  end if;

  perform public._auto_close_stale_business_days();
  select a.business_day_id, a.cash_session_id
    into v_business_day_id, v_cash_session_id
    from public._current_assignment(v_uid, now()) a;
  if v_cash_session_id is not null then
    declare
      v_current_status text;
    begin
      select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
      if v_current_status is distinct from 'open' then
        v_cash_session_id := null;
      end if;
    end;
  end if;

  select status, total into v_status, v_total
  from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only pending receivables can be paid' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where order_id = p_order_id;
  v_balance := v_total - v_paid;
  if v_pay_sum > v_balance then
    raise exception 'The amount exceeds the balance' using errcode = 'P0001';
  end if;

  for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
  loop
    insert into public.payments (order_id, payment_method, amount, created_by, business_day_id, cash_session_id)
    values (
      p_order_id,
      (v_pay ->> 'method')::public.payment_method,
      (v_pay ->> 'amount')::numeric,
      v_uid,
      v_business_day_id,
      v_cash_session_id
    );
  end loop;

  v_balance := v_balance - v_pay_sum;
  if v_balance = 0 then
    update public.orders
       set status = 'completed',
           settled_at = now(),
           business_day_id = v_business_day_id
     where id = p_order_id;
    v_status := 'completed';
  end if;

  v_result := jsonb_build_object('balance', v_balance, 'status', v_status);

  if p_idempotency_key is not null then
    update public.idempotency_keys
       set result = v_result
     where key = p_idempotency_key;
  end if;

  return v_result;
end;
$$;

-- B8 (U1, R-1): blind cash count. A cashier must not see `expected_cash` (or infer the difference) before
-- closing; manager+ always sees it. Once closed, the figure shown is the one that was actually reconciled
-- (frozen at close time), never a live recompute that a later refund/expense/void could silently change.
create or replace function public.cash_session_summary(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cash jsonb;
  v_row  public.cash_sessions%rowtype;
  v_name text;
  v_uid  uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.cash_sessions where id = p_session_id;
  if not found then
    raise exception 'Cash session not found' using errcode = 'P0002';
  end if;
  if not public.has_min_role('manager')
     and not exists (
       select 1 from public.cash_session_users csu
       where csu.session_id = v_row.id and csu.user_id = v_uid
     ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select name into v_name from public.cash_registers where id = v_row.register_id;
  v_cash := public._session_cash(p_session_id);
  if v_row.status = 'closed' then
    v_cash := v_cash || jsonb_build_object('expected_cash', v_row.expected_cash);
  elsif not public.has_min_role('manager') then
    v_cash := v_cash - 'expected_cash';
  end if;
  return v_cash || jsonb_build_object(
    'session_id', v_row.id,
    'register_id', v_row.register_id,
    'register_name', v_name,
    'status', v_row.status,
    'counted_cash', v_row.counted_cash,
    'difference', v_row.difference,
    'needs_review', v_row.needs_review,
    'opened_at', v_row.opened_at,
    'closed_at', v_row.closed_at
  );
end;
$$;

-- B8: the cashier only learns the difference AFTER closing, from this return value.
-- Return type changes void -> jsonb, so CREATE OR REPLACE is not allowed; drop first.
drop function if exists public.close_cash_session(uuid, numeric, text);

create function public.close_cash_session(
  p_session_id uuid,
  p_counted_cash numeric,
  p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_scale     int := public.money_scale();
  v_status    text;
  v_expected  numeric(14, 2);
  v_tolerance numeric(14, 2);
  v_difference numeric(14, 2);
  v_needs_review boolean;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not public.has_min_role('manager')
     and not exists (
       select 1 from public.cash_session_users where session_id = p_session_id and user_id = v_uid
     ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 or p_counted_cash <> round(p_counted_cash, v_scale) then
    raise exception 'Invalid counted cash' using errcode = 'P0001';
  end if;

  select status into v_status from public.cash_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Cash session not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The session is not open' using errcode = 'P0001';
  end if;

  v_expected := (public._session_cash(p_session_id) ->> 'expected_cash')::numeric;
  v_tolerance := coalesce(
    (select (s.value #>> '{}')::numeric from public.settings s where s.key = 'cash_count_tolerance'),
    0
  );
  v_difference := p_counted_cash - v_expected;
  v_needs_review := abs(v_difference) > v_tolerance;
  update public.cash_sessions
     set status = 'closed',
         closed_at = now(),
         closed_by = v_uid,
         counted_cash = p_counted_cash,
         expected_cash = v_expected,
         difference = v_difference,
         needs_review = v_needs_review,
         notes = nullif(btrim(p_notes), '')
   where id = p_session_id;

  return jsonb_build_object(
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', v_difference,
    'needs_review', v_needs_review
  );
end;
$$;

revoke all on function public.close_cash_session(uuid, numeric, text) from public, anon;
grant execute on function public.close_cash_session(uuid, numeric, text) to authenticated;
