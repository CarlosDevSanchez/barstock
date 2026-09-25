-- Second-pass adversarial review (Opus) of fix/adversarial-a-f: real regressions and gaps found in the first
-- pass. See docs/04-auditoria/hallazgos/H6-revision-adversarial-a-f.md for the full writeup.

-- P1-b: `cash_session_summary` only hid `expected_cash`, but a cashier could still sum opening_float + cash_sales
-- + open_tab_cash + deposits - withdrawals - refunded_cash - expenses - purchases to derive the exact same
-- number. While the session is open and the caller is not manager+, hide every component that feeds that sum;
-- only `opening_float` (already known: the cashier counted it in at open) survives.
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
  v_cash := public._session_cash(p_session_id);
  if v_row.status = 'closed' then
    v_cash := v_cash || jsonb_build_object('expected_cash', v_row.expected_cash);
  elsif not public.has_min_role('manager') then
    v_cash := jsonb_build_object('opening_float', v_cash -> 'opening_float');
  end if;
  select name into v_name from public.cash_registers where id = v_row.register_id;
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

-- P1-c (M2/B3, decision confirmed by the user): a cash refund is subtracted from the ORIGINAL payment's session
-- if that session is still open. If it has since closed, nothing is subtracted from any till (the reconciled
-- figure is not touched) and the order is flagged `refund_after_close` for a manager to review. This replaces
-- the earlier (wrong) behavior of crediting the REFUNDING user's own current session, which let a manager with
-- no session of their own silently misattribute the refund, or attribute it to an unrelated till.
-- At most one 'cash' payment per order (duplicate methods are rejected by create_sale/pay_receivable), so
-- `payments.cash_session_id` unambiguously identifies "the till that took this order's cash".
alter table public.orders
  add column if not exists refund_after_close boolean not null default false;

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

-- P2: `_current_assignment` matched a cash session purely by `p_at` falling in its open window, without
-- requiring it to belong to the SAME business day chosen for that instant. Two sessions on the same register at
-- different times always belong to the same day in practice, but a cross-day session (e.g. one left open across
-- an admin-adjusted boundary) must not be picked for a day it does not belong to.
create or replace function public._current_assignment(p_user uuid, p_at timestamptz)
returns table (business_day_id uuid, cash_session_id uuid)
language sql stable security definer set search_path = ''
as $$
  with day as (
    select bd.id from public.business_days bd
    where bd.opened_at <= p_at and (bd.closed_at is null or bd.closed_at > p_at)
    order by bd.opened_at desc
    limit 1
  )
  select
    (select id from day),
    (
      select cs.id from public.cash_sessions cs
      join public.cash_session_users csu on csu.session_id = cs.id
      where csu.user_id = p_user
        and cs.business_day_id = (select id from day)
        and cs.opened_at <= p_at and (cs.closed_at is null or cs.closed_at > p_at)
      order by cs.opened_at desc
      limit 1
    );
$$;

-- P2: close_business_day computed `expected_cash = _session_cash(cs.id)` in the SAME update that locks the
-- session, so a concurrent insert racing the `for update` wait (a deposit, a sale) could land between the lock
-- being granted and `_session_cash` being evaluated for THAT row, and still be missed if evaluated from a stale
-- plan. Lock every open session for this day first, in its own statement, then compute `_session_cash` per row
-- in a loop — so each read genuinely happens after the row (and everything it aggregates) is locked/committed.
create or replace function public.close_business_day(p_id uuid, p_notes text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_open boolean;
  v_session record;
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

  for v_session in
    select id, opened_at from public.cash_sessions
    where business_day_id = p_id and status = 'open'
    for update
  loop
    update public.cash_sessions
       set status = 'closed',
           closed_at = greatest(now(), v_session.opened_at + interval '1 millisecond'),
           needs_review = true,
           counted_cash = null,
           expected_cash = (public._session_cash(v_session.id) ->> 'expected_cash')::numeric,
           difference = null
     where id = v_session.id;
  end loop;

  update public.business_days
     set closed_at = now(),
         closed_by = v_uid,
         close_kind = 'manual',
         needs_review = v_open,
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_id;
end;
$$;

-- P2: _claim_outbox must increment `attempts` on claim (not only markFailure), or a row stuck reclaiming every
-- 10 minutes without ever reaching attempts >= 5 would retry forever instead of eventually giving up.
create or replace function public._claim_outbox(p_limit int)
returns setof public.notification_outbox
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select o.id
    from public.notification_outbox o
    where o.processed_at is null
      and o.attempts < 5
      and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
    order by o.id
    for update of o skip locked
    limit least(coalesce(p_limit, 50), 50)
  )
  update public.notification_outbox n
     set claimed_at = now(),
         attempts = n.attempts + 1
    from picked
   where n.id = picked.id
  returning n.*;
end;
$$;

-- P2: dedup must also skip a NEW reminder while yesterday's is still sitting unprocessed (not just "already
-- enqueued today") — otherwise two rows for the same order pile up in the outbox instead of one that keeps
-- getting reclaimed and retried.
create or replace function public._enqueue_due_receivables()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_today date;
begin
  v_tz := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
    'UTC'
  );
  v_today := (now() at time zone v_tz)::date;

  insert into public.notification_outbox (kind, payload)
  select 'receivable_due', jsonb_build_object('order_id', ord.id)
  from public.orders ord
  where ord.status = 'pending'
    and ord.reminder_enabled
    and ord.due_date is not null
    and ord.due_date <= v_today
    and not exists (
      select 1
      from public.notification_outbox o
      where o.kind = 'receivable_due'
        and o.payload ->> 'order_id' = ord.id::text
        and (
          (o.created_at at time zone v_tz)::date = v_today
          or o.processed_at is null
        )
    );
end;
$$;

-- C1 fix-of-the-fix: the payments-collected-on-a-written-off-order revenue added to net_profit was the gross
-- (tax-inclusive) payment amount, while every other term in net_profit is tax-exclusive (gross_profit is built
-- from line_base, before tax). Strip the order's proportional tax from that contribution only; total_revenue and
-- the daily breakdown keep the gross amount (consistent with how total_revenue is tax-inclusive everywhere else).
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
           (ord.settled_at at time zone v_tz)::date as day
    from public.orders ord
    where ord.status = 'completed'
      and ord.settled_at >= v_start
      and ord.settled_at < v_end
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
      (coalesce(oi.unit_cost, p.cost_price) * oi.quantity) as line_cogs
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
  ),
  wo as (
    select ord.id, ord.total,
           (ord.total - coalesce((select sum(p.amount) from public.payments p where p.order_id = ord.id), 0))
             as balance
    from public.orders ord
    where ord.status = 'written_off'
      and ord.written_off_at >= v_start
      and ord.written_off_at < v_end
  ),
  wo_cogs as (
    select coalesce(sum(coalesce(oi.unit_cost, p.cost_price) * oi.quantity), 0) as total
    from wo
    join public.order_items oi on oi.order_id = wo.id
    join public.products p on p.id = oi.product_id
  ),
  wo_payments as (
    -- A payment collected on a written-off receivable is real revenue, counted on the day it was actually
    -- collected (not the write-off date, and not double-counted with `o`, which excludes written_off orders).
    -- `amount_net_of_tax` strips the order's proportional tax, matching net_profit's tax-exclusive basis
    -- (gross_profit is built from line_base, before tax) -- only `amount` (gross) feeds total_revenue/daily.
    select pay.amount,
           (pay.created_at at time zone v_tz)::date as day,
           case when ord.total > 0 then pay.amount * (ord.total - ord.tax) / ord.total else pay.amount end
             as amount_net_of_tax
    from public.payments pay
    join public.orders ord on ord.id = pay.order_id
    where ord.status = 'written_off'
      and pay.created_at >= v_start
      and pay.created_at < v_end
  )
  select jsonb_build_object(
    'from', to_char(p_from, 'YYYY-MM-DD'),
    'to', to_char(p_to, 'YYYY-MM-DD'),
    'time_zone', v_tz,
    'total_orders', (select count(*) from o),
    'total_revenue', (select coalesce(sum(total), 0) from o) + (select coalesce(sum(amount), 0) from wo_payments),
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
    'total_expenses', (
      select coalesce(sum(e.amount), 0)
      from public.expenses e
      where e.deleted_at is null
        and e.occurred_at >= v_start
        and e.occurred_at < v_end
    ),
    'expenses_by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'total', x.total) order by c.name), '[]'::jsonb)
      from (
        select e.category_id, sum(e.amount) as total
        from public.expenses e
        where e.deleted_at is null
          and e.occurred_at >= v_start
          and e.occurred_at < v_end
        group by e.category_id
      ) x
      join public.expense_categories c on c.id = x.category_id
    ),
    -- The uncollected balance of write-offs in range, shown for visibility. It is NOT subtracted from
    -- net_profit (only the cost of the goods that went out the door is); the balance was never revenue.
    'written_off_total', (select coalesce(sum(balance), 0) from wo),
    'net_profit', (
      select coalesce(sum(line_base), 0) - coalesce(sum(line_cogs), 0) from line_money
    ) + (
      select coalesce(sum(amount_net_of_tax), 0) from wo_payments
    ) - (
      select coalesce(sum(discount), 0) from o
    ) - (
      select coalesce(sum(e.amount), 0)
      from public.expenses e
      where e.deleted_at is null
        and e.occurred_at >= v_start
        and e.occurred_at < v_end
    ) - (
      select total from wo_cogs
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(g.d, 'YYYY-MM-DD'),
               'revenue', coalesce(x.revenue, 0) + coalesce(w.revenue, 0),
               'orders', coalesce(x.orders, 0)) order by g.d), '[]'::jsonb)
      from generate_series(p_from, p_to, interval '1 day') as g(d)
      left join (select day, sum(total) as revenue, count(*) as orders from o group by day) x
             on x.day = g.d::date
      left join (select day, sum(amount) as revenue from wo_payments group by day) w
             on w.day = g.d::date),
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
        select pay.payment_method as method, count(distinct pay.order_id)::int as orders, sum(pay.amount) as amount
        from public.payments pay
        join o on o.id = pay.order_id
        group by pay.payment_method) t)
  ) into v_result;

  return v_result;
end;
$$;

-- B5 vs business_day_report: an order already assigned to a specific business day (business_day_id set) could
-- ALSO match another day's settled_at window, double-counting it across the two days' reports. Only fall back to
-- settled_at-based matching for orders that have NO business_day_id at all (orphaned settlements, the case M6
-- actually needed to fix); an order that belongs to a day is counted in that day only. Same tax fix as C1 above.
create or replace function public.business_day_report(p_business_day_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day public.business_days%rowtype;
  v_end timestamptz;
begin
  if (select auth.uid()) is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_day from public.business_days where id = p_business_day_id;
  if not found then
    raise exception 'Business day not found' using errcode = 'P0002';
  end if;
  v_end := coalesce(v_day.closed_at, now());

  return jsonb_build_object(
    'business_day_id', v_day.id,
    'opened_at', v_day.opened_at,
    'closed_at', v_day.closed_at,
    'close_kind', v_day.close_kind,
    'needs_review', v_day.needs_review,
    'total_orders', (
      select count(*) from public.orders o
      where o.status = 'completed'
        and (o.business_day_id = v_day.id
             or (o.business_day_id is null and o.settled_at >= v_day.opened_at and o.settled_at < v_end))
    ),
    'total_revenue', (
      select coalesce(sum(o.total), 0) from public.orders o
      where o.status = 'completed'
        and (o.business_day_id = v_day.id
             or (o.business_day_id is null and o.settled_at >= v_day.opened_at and o.settled_at < v_end))
    ) + (
      select coalesce(sum(pay.amount), 0)
      from public.payments pay
      join public.orders o on o.id = pay.order_id
      where o.status = 'written_off'
        and pay.created_at >= v_day.opened_at and pay.created_at < v_end
    ),
    'sales_without_register', (
      select count(*) from public.orders o
      where o.status = 'completed' and o.cash_session_id is null
        and (o.business_day_id = v_day.id
             or (o.business_day_id is null and o.settled_at >= v_day.opened_at and o.settled_at < v_end))
    ),
    'payments_by_method', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_method', pay.payment_method,
        'order_count', pay.order_count,
        'total', pay.total
      ) order by pay.payment_method)
      from (
        select p.payment_method, count(distinct p.order_id) as order_count, coalesce(sum(p.amount), 0) as total
        from public.payments p
        join public.orders o on o.id = p.order_id
        where o.status = 'completed'
          and (o.business_day_id = v_day.id
               or (o.business_day_id is null and o.settled_at >= v_day.opened_at and o.settled_at < v_end))
        group by p.payment_method
      ) pay
    ), '[]'::jsonb),
    'total_expenses', (
      select coalesce(sum(e.amount), 0) from public.expenses e
      where e.business_day_id = v_day.id and e.deleted_at is null
    ),
    'expenses_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', c.name, 'total', x.total) order by c.name)
      from (
        select e.category_id, sum(e.amount) as total
        from public.expenses e
        where e.business_day_id = v_day.id and e.deleted_at is null
        group by e.category_id
      ) x
      join public.expense_categories c on c.id = x.category_id
    ), '[]'::jsonb),
    -- Uncollected balance of write-offs whose written_off_at falls in this day, shown for visibility only.
    'written_off_total', (
      select coalesce(sum(
        o.total - coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0)
      ), 0)
      from public.orders o
      where o.status = 'written_off'
        and o.written_off_at >= v_day.opened_at and o.written_off_at < v_end
    ),
    'net_profit', (
      select coalesce(sum((oi.unit_price * oi.quantity - oi.discount)
        - (coalesce(oi.unit_cost, p.cost_price) * oi.quantity)), 0)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.products p on p.id = oi.product_id
      where o.status = 'completed'
        and (o.business_day_id = v_day.id
             or (o.business_day_id is null and o.settled_at >= v_day.opened_at and o.settled_at < v_end))
    ) + (
      select coalesce(sum(case when o.total > 0 then pay.amount * (o.total - o.tax) / o.total else pay.amount end), 0)
      from public.payments pay
      join public.orders o on o.id = pay.order_id
      where o.status = 'written_off'
        and pay.created_at >= v_day.opened_at and pay.created_at < v_end
    ) - (
      select coalesce(sum(o.discount), 0) from public.orders o
      where o.status = 'completed'
        and (o.business_day_id = v_day.id
             or (o.business_day_id is null and o.settled_at >= v_day.opened_at and o.settled_at < v_end))
    ) - (
      select coalesce(sum(e.amount), 0) from public.expenses e
      where e.business_day_id = v_day.id and e.deleted_at is null
    ) - (
      select coalesce(sum(coalesce(oi.unit_cost, p.cost_price) * oi.quantity), 0)
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      join public.products p on p.id = oi.product_id
      where o.status = 'written_off'
        and o.written_off_at >= v_day.opened_at and o.written_off_at < v_end
    ),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id', cs.id,
        'register_name', cr.name,
        'opening_float', cs.opening_float,
        'expected_cash', coalesce(cs.expected_cash, (public._session_cash(cs.id) ->> 'expected_cash')::numeric),
        'counted_cash', cs.counted_cash,
        'difference', cs.difference,
        'needs_review', cs.needs_review,
        'status', cs.status
      ) order by cr.name)
      from public.cash_sessions cs
      join public.cash_registers cr on cr.id = cs.register_id
      where cs.business_day_id = v_day.id
    ), '[]'::jsonb)
  );
end;
$$;

-- B7 fix-of-the-fix: the "no cash leg" branch could still collapse two non-cash payments (e.g. card+ewallet)
-- into one, dropping one of them, and `payment_adjusted` only logged the single touched scalar instead of the
-- full payment arrays. Rewritten to drain deterministically (cash first if present, else the last payment first)
-- and only collapse to one payment when draining both legs still cannot reach the total.
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

-- U3 (idempotency, critical for real money) + E1 (lock order, supplier validation): receive_purchase gets the
-- same idempotency_keys pattern as create_sale/pay_receivable (a retried request returns the original purchase
-- instead of double-receiving stock), locks inventory rows in a deterministic order (sorted by product_id, like
-- create_sale) to avoid deadlocking against a concurrent receive_purchase/void_purchase/create_sale, and rejects
-- a soft-deleted supplier.
drop function if exists public.receive_purchase(uuid, jsonb, text, text, uuid);

create function public.receive_purchase(
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

  -- Sorted so concurrent receive_purchase/void_purchase/create_sale calls lock inventory rows in the same order.
  for v_entry in
    select value from jsonb_array_elements(p_items) as t(value)
    order by (value ->> 'product_id')
  loop
    v_product := (v_entry ->> 'product_id')::uuid;
    v_qty := (v_entry ->> 'quantity')::int;
    v_cost := round((v_entry ->> 'unit_cost')::numeric, 2);

    insert into public.purchase_order_items (
      purchase_order_id, product_id, quantity, unit_price
    ) values (v_id, v_product, v_qty, v_cost);

    select id into v_inv_id
    from public.inventory
    where product_id = v_product and variant_id is null
    for update;
    if not found then
      raise exception 'Inventory row not found for product' using errcode = 'P0001';
    end if;

    update public.inventory
       set quantity = quantity + v_qty,
           last_restocked_at = now()
     where id = v_inv_id;

    insert into public.inventory_transactions (
      inventory_id, transaction_type, quantity, reference_id,
      supplier_id, unit_cost, created_by
    ) values (
      v_inv_id, 'purchase', v_qty, v_id,
      p_supplier_id, v_cost, v_uid
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
