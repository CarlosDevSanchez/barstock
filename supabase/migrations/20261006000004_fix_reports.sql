-- R-C: reports and receivables fixes (M5, M6, C3-C8).

-- C1 (M5): written_off_total is shown separately (the uncollected balance); net_profit now deducts only the
-- COST of goods for written-off orders (they never counted as revenue, so only their COGS is a real loss), and
-- payments actually collected on a written-off order count as revenue on the day they were collected.
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
    select pay.amount, (pay.created_at at time zone v_tz)::date as day
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
      select coalesce(sum(amount), 0) from wo_payments
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

-- C2 (M6): if no business day is open when a receivable settles, it keeps whatever business_day_id it already
-- had (from when it was deferred) instead of being wiped to NULL.
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
           business_day_id = coalesce(v_business_day_id, business_day_id)
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

-- C2 (M6): also count orders that settled inside this day's window even if their stored business_day_id is
-- stale/null (a receivable paid off with no day open used to lose its day link entirely), and give written-off
-- orders the same treatment as C1 (cost only, payments collected in range as revenue).
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
             or (o.settled_at >= v_day.opened_at and o.settled_at < v_end))
    ),
    'total_revenue', (
      select coalesce(sum(o.total), 0) from public.orders o
      where o.status = 'completed'
        and (o.business_day_id = v_day.id
             or (o.settled_at >= v_day.opened_at and o.settled_at < v_end))
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
             or (o.settled_at >= v_day.opened_at and o.settled_at < v_end))
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
               or (o.settled_at >= v_day.opened_at and o.settled_at < v_end))
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
             or (o.settled_at >= v_day.opened_at and o.settled_at < v_end))
    ) + (
      select coalesce(sum(pay.amount), 0)
      from public.payments pay
      join public.orders o on o.id = pay.order_id
      where o.status = 'written_off'
        and pay.created_at >= v_day.opened_at and pay.created_at < v_end
    ) - (
      select coalesce(sum(o.discount), 0) from public.orders o
      where o.status = 'completed'
        and (o.business_day_id = v_day.id
             or (o.settled_at >= v_day.opened_at and o.settled_at < v_end))
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

-- C3: indexes for the lookups this block (and the daily dashboard) does most often.
create index if not exists orders_settled_at_idx on public.orders (settled_at);
create index if not exists orders_tab_id_idx on public.orders (tab_id);
create index if not exists expenses_cash_session_id_idx on public.expenses (cash_session_id);
create index if not exists expenses_business_day_id_idx on public.expenses (business_day_id);
create index if not exists purchase_orders_cash_session_id_idx on public.purchase_orders (cash_session_id);
create index if not exists notification_outbox_kind_order_idx
  on public.notification_outbox (kind, (payload ->> 'order_id'));

-- C8: unit_cost snapshot uses the variant's own cost_price when the line has one, falling back to the
-- product's. Only this expression changes from the current create_sale / _create_order_from_tab.
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

-- C8: same variant-cost fallback for tabs closing into an order.
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
    (select coalesce(v.cost_price, p.cost_price) from public.products p
       left join public.product_variants v on v.id = ti.variant_id
      where p.id = ti.product_id)
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
