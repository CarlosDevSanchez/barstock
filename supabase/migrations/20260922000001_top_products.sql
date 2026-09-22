-- 0007 top_selling_products: the "quick sell" panel needs the whole store's best sellers of the last N days, by
-- units sold, excluding refunds. `dashboard_summary`/`sales_report` (0005) are SECURITY INVOKER on purpose (a
-- cashier's dashboard only counts their own sales, under `orders_select` RLS); this one is SECURITY DEFINER because
-- the mode-of-sale needs the WHOLE store's numbers regardless of who is at the till. It only ever returns aggregated
-- product stats (name, price, stock, units sold) — never order, customer or payment data — so it stays safe to widen.
-- Assumption recorded as D-top5 in docs/06-roadmap/decisiones-pendientes.md.

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
      and o.created_at >= now() - make_interval(days => p_days)
      and p.is_active
      and p.deleted_at is null
    group by p.id, p.name, p.selling_price, i.quantity, c.name
    order by sum(oi.quantity) desc, sum(oi.total) desc, p.name
    limit p_limit;
end;
$$;

-- Supabase grants EXECUTE to anon by default: only signed-in users may call it (it re-checks the role itself).
revoke all on function public.top_selling_products(int, int) from public, anon;
grant execute on function public.top_selling_products(int, int) to authenticated;
