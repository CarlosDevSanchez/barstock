-- Per-product low-stock threshold. Direct UPDATE on inventory stays revoked; managers go through this RPC.
-- A new product still receives settings.low_stock_threshold from create_inventory_for_product. createProduct calls
-- this afterwards only when the form sent an explicit value.

create or replace function public.set_low_stock_threshold(p_inventory_id uuid, p_threshold int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_threshold is null or p_threshold < 0 then
    raise exception 'Invalid threshold' using errcode = 'P0001';
  end if;

  update public.inventory
     set low_stock_threshold = p_threshold
   where id = p_inventory_id;
  if not found then
    raise exception 'Inventory not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_low_stock_threshold(uuid, int) from public, anon;
grant execute on function public.set_low_stock_threshold(uuid, int) to authenticated;
