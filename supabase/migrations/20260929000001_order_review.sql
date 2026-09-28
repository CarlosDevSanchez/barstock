-- 0019 mark_order_reviewed: the manager-review step for an order that synced with issues (F4,
-- docs/06-roadmap/offline-y-sincronizacion.md) — occurred_at_clamped, price_mismatch and/or stock_shortfall,
-- written by create_sale (F2, migration 20260928000001_offline_sales.sql). Only sets reviewed_by/reviewed_at;
-- fixing the underlying stock shortfall (if any) is a separate, ordinary inventory adjustment (adjust_inventory),
-- linked to from the order detail page.

create or replace function public.mark_order_reviewed(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sync_issues jsonb;
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select sync_issues into v_sync_issues from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_sync_issues is null then
    raise exception 'This order has no sync issues to review';
  end if;

  -- Re-marking an already-reviewed order just refreshes who/when: never an error (mirrors refund_order's
  -- idempotency), since two managers clicking "mark reviewed" close together is a normal race, not a conflict.
  update public.orders set reviewed_by = v_uid, reviewed_at = now() where id = p_order_id;
end;
$$;

revoke all on function public.mark_order_reviewed(uuid) from public, anon;
grant execute on function public.mark_order_reviewed(uuid) to authenticated;
