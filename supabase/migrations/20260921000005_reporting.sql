-- 0005 reporting: aggregation in SQL instead of the browser.
--
-- Both functions are SECURITY INVOKER: they run with the caller's RLS, so a cashier's dashboard only counts their own
-- sales while a manager's counts everyone's. Only completed orders count (refunded ones are excluded). Days are
-- bucketed in the store's time zone (settings.timezone, default UTC) and low stock uses each row's own threshold.

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
    select ord.id, ord.total, (ord.created_at at time zone v_tz)::date as day
    from public.orders ord
    where ord.status = 'completed'
      and ord.created_at >= (least(v_month, v_today - 29))::timestamp at time zone v_tz
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
           (ord.created_at at time zone v_tz)::date as day
    from public.orders ord
    where ord.status = 'completed' and ord.created_at >= v_start and ord.created_at < v_end
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
        select p.id as product_id, p.name, sum(oi.quantity)::int as quantity, sum(oi.total) as revenue
        from public.order_items oi
        join o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        group by p.id, p.name
        order by revenue desc, quantity desc
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
