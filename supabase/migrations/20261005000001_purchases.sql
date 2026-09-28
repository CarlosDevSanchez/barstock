-- Receive supplier purchases into stock (without changing products.cost_price).
-- Cash paid from an open till reduces expected drawer cash via _session_cash.

alter table public.purchase_orders
  add column if not exists invoice_number text,
  add column if not exists business_day_id uuid references public.business_days (id),
  add column if not exists cash_session_id uuid references public.cash_sessions (id);

alter table public.inventory_transactions
  add column if not exists supplier_id uuid references public.suppliers (id),
  add column if not exists unit_cost numeric(14, 2);

create sequence if not exists public.purchase_order_number_seq;

create trigger audit_row_change after insert or update or delete on public.purchase_orders
  for each row execute function public.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.purchase_order_items
  for each row execute function public.audit_row_change();

-- Writes go through receive_purchase / void_purchase. Select stays manager+.
drop policy if exists purchase_orders_insert on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;
drop policy if exists purchase_orders_delete on public.purchase_orders;
drop policy if exists purchase_order_items_insert on public.purchase_order_items;
drop policy if exists purchase_order_items_update on public.purchase_order_items;
drop policy if exists purchase_order_items_delete on public.purchase_order_items;
revoke insert, update, delete on public.purchase_orders from authenticated;
revoke insert, update, delete on public.purchase_order_items from authenticated;

create or replace function public.receive_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_invoice text,
  p_notes text,
  p_cash_session_id uuid
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
begin
  if v_uid is null or not public.has_min_role('manager') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_supplier_id is null or not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id
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

  for v_entry in select value from jsonb_array_elements(p_items) as t(value)
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

  return v_id;
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
begin
  if v_uid is null or not public.has_min_role('admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A reason is required' using errcode = 'P0001';
  end if;

  select status, supplier_id into v_status, v_supplier
  from public.purchase_orders
  where id = p_id
  for update;
  if not found then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if v_status is distinct from 'received' then
    raise exception 'Purchase is not received' using errcode = 'P0001';
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
     set status = 'cancelled'
   where id = p_id;
end;
$$;

create or replace function public.supplier_purchase_history(
  p_supplier_id uuid,
  p_from date,
  p_to date
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz     text := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
    'UTC'
  );
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

  with po as (
    select id, po_number, invoice_number, received_at, total_amount
    from public.purchase_orders
    where supplier_id = p_supplier_id
      and status = 'received'
      and received_at >= v_start
      and received_at < v_end
  ),
  lines as (
    select
      poi.product_id,
      p.name,
      poi.quantity,
      poi.unit_price,
      po.received_at
    from public.purchase_order_items poi
    join po on po.id = poi.purchase_order_id
    join public.products p on p.id = poi.product_id
  ),
  agg as (
    select
      product_id,
      name,
      sum(quantity)::int as quantity,
      (
        select l2.unit_price
        from lines l2
        where l2.product_id = lines.product_id
        order by l2.received_at desc, l2.unit_price desc
        limit 1
      ) as last_unit_cost,
      case when sum(quantity) = 0 then 0
           else round(sum(quantity * unit_price) / sum(quantity), 2)
      end as average_unit_cost
    from lines
    group by product_id, name
  )
  select jsonb_build_object(
    'purchases', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', po.id,
          'po_number', po.po_number,
          'invoice_number', po.invoice_number,
          'received_at', po.received_at,
          'total_amount', po.total_amount
        )
        order by po.received_at desc
      )
      from po
    ), '[]'::jsonb),
    'total', coalesce((select sum(total_amount) from po), 0),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', a.product_id,
          'name', a.name,
          'quantity', a.quantity,
          'last_unit_cost', a.last_unit_cost,
          'average_unit_cost', a.average_unit_cost
        )
        order by a.name
      )
      from agg a
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Cash paid for received purchases on this till reduces expected cash.
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

  select coalesce(sum(p.amount), 0) into v_refunded
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.cash_session_id = p_session_id and p.payment_method = 'cash' and o.status = 'refunded';

  select coalesce(sum(e.amount), 0) into v_expenses
  from public.expenses e
  where e.cash_session_id = p_session_id
    and e.payment_method = 'cash'
    and e.deleted_at is null;

  select coalesce(sum(po.total_amount), 0) into v_purchases
  from public.purchase_orders po
  where po.cash_session_id = p_session_id
    and po.status = 'received';

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

revoke all on function public.receive_purchase(uuid, jsonb, text, text, uuid) from public, anon;
revoke all on function public.void_purchase(uuid, text) from public, anon;
revoke all on function public.supplier_purchase_history(uuid, date, date) from public, anon;
grant execute on function public.receive_purchase(uuid, jsonb, text, text, uuid) to authenticated;
grant execute on function public.void_purchase(uuid, text) to authenticated;
grant execute on function public.supplier_purchase_history(uuid, date, date) to authenticated;
