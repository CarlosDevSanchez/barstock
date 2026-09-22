-- 0008 tabs (open accounts): shared, split-payment accounts for the POS ("Mesa 4", "Jhon", a walk-in group).
--
-- Business assumptions (recorded as D-tabs in docs/06-roadmap/decisiones-pendientes.md):
--   * Stock decrements when a product is ADDED to a tab (not when the tab closes) and returns when an item is
--     removed or the tab is voided — mirrors what a physical bar does (the bottle is already open).
--   * A tab_item's price and tax rate are a PHOTO taken the first time that product is added: adding more of the
--     same product later adds quantity at that same price, it never re-prices already-added units (D3 for `create_sale`
--     already fixes the price at sale time; a tab is just a sale-in-progress).
--   * Tabs are visible to and shared between every cashier (any of them may serve any table); only a manager+ may
--     remove an item or void a tab.
--   * A tab can be voided only while it has no payments; it closes itself into a normal, immutable `orders` row the
--     moment payments cover the total (partial-payment split), and `refund_order` on that order works unchanged.
--   * `top_selling_products` (0007) and the dashboard already read from `orders`/`order_items`, so a closed tab's
--     sale is included automatically — nothing there needs to change.
--
-- Error convention (same as 0004/0006): P0001 (default) = message for the end user, P0002 = not found, 42501 = not
-- allowed. Every RPC locks the tab row with `select ... for update` before checking `status`, so concurrent actions
-- on the SAME tab serialize instead of racing.

create type public.tab_status as enum ('open', 'closed', 'voided');
create sequence if not exists public.tab_number_seq;

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.tabs (
  id           uuid primary key default uuid_generate_v4(),
  tab_number   text not null unique,
  label        text not null check (btrim(label) <> ''),
  customer_id  uuid references public.customers (id),
  status       public.tab_status not null default 'open',
  discount     numeric(14, 2) not null default 0 check (discount >= 0),
  order_id     uuid references public.orders (id),
  opened_by    uuid references auth.users (id),
  closed_by    uuid references auth.users (id),
  voided_by    uuid references auth.users (id),
  void_reason  text,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz,
  voided_at    timestamptz,
  updated_at   timestamptz not null default now(),
  constraint tabs_closed_has_order check (status <> 'closed' or order_id is not null),
  constraint tabs_voided_has_reason check (status <> 'voided' or void_reason is not null)
);
-- Partial index: the only listing that matters at speed is "what's open right now".
create index tabs_open_idx on public.tabs (opened_at desc) where status = 'open';

create table public.tab_members (
  id            uuid primary key default uuid_generate_v4(),
  tab_id        uuid not null references public.tabs (id) on delete cascade,
  display_name  text not null check (btrim(display_name) <> ''),
  customer_id   uuid references public.customers (id),
  created_at    timestamptz not null default now()
);
create index tab_members_tab_idx on public.tab_members (tab_id);

create table public.tab_items (
  id          uuid primary key default uuid_generate_v4(),
  tab_id      uuid not null references public.tabs (id) on delete cascade,
  product_id  uuid not null references public.products (id),
  variant_id  uuid references public.product_variants (id),
  quantity    int not null check (quantity > 0),
  -- The photo of the price/tax the first time this product was added (see the D-tabs note above).
  unit_price  numeric(14, 2) not null,
  tax_rate    numeric(6, 4) not null,
  added_by    uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Postgres 17: adding the same product/variant again upserts (sums quantity) instead of creating a second line.
  unique nulls not distinct (tab_id, product_id, variant_id)
);
create index tab_items_tab_idx on public.tab_items (tab_id);

create table public.tab_payments (
  id              uuid primary key default uuid_generate_v4(),
  tab_id          uuid not null references public.tabs (id) on delete cascade,
  member_id       uuid references public.tab_members (id),
  payment_method  public.payment_method not null,
  amount          numeric(14, 2) not null check (amount > 0),
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);
create index tab_payments_tab_idx on public.tab_payments (tab_id);

-- The history of a closed tab is just the order it became.
alter table public.orders add column tab_id uuid references public.tabs (id);

-- ---------------------------------------------------------------------------
-- RLS: read-only from the API (cashier+, shared across every cashier); every write goes through the RPCs below.
-- ---------------------------------------------------------------------------
alter table public.tabs enable row level security;
alter table public.tab_members enable row level security;
alter table public.tab_items enable row level security;
alter table public.tab_payments enable row level security;

create policy tabs_select on public.tabs for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy tab_members_select on public.tab_members for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy tab_items_select on public.tab_items for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy tab_payments_select on public.tab_payments for select to authenticated
  using ((select public.has_min_role('cashier')));

revoke all on public.tabs, public.tab_members, public.tab_items, public.tab_payments from anon;
revoke insert, update, delete on public.tabs, public.tab_members, public.tab_items, public.tab_payments
  from authenticated;

-- ---------------------------------------------------------------------------
-- _tab_totals: the same formula as create_sale (D3) — base = unit_price*qty, tax rounded per line to the currency's
-- decimals, global discount applied after tax. Internal: no grant, called only from the RPCs and from tab_summary.
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

  for v_item in select ti.quantity, ti.unit_price, ti.tax_rate from public.tab_items ti where ti.tab_id = p_tab_id loop
    v_base := v_item.unit_price * v_item.quantity;
    v_subtotal := v_subtotal + v_base;
    v_tax := v_tax + round(v_base * v_item.tax_rate, v_scale);
  end loop;

  v_total := greatest(v_subtotal + v_tax - v_discount, 0);
  select coalesce(sum(amount), 0) into v_paid from public.tab_payments where tab_id = p_tab_id;

  return query select v_subtotal, v_tax, v_discount, v_total, v_paid, greatest(v_total - v_paid, 0);
end;
$$;
revoke all on function public._tab_totals(uuid) from public, anon, authenticated;

-- Public read: the API's tab detail endpoint uses this instead of recomputing totals in TypeScript.
create or replace function public.tab_summary(p_tab_id uuid)
returns table (subtotal numeric, tax numeric, discount numeric, total numeric, paid numeric, balance numeric)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tabs where id = p_tab_id) then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  return query select * from public._tab_totals(p_tab_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- _close_tab: turns a fully-paid tab into a normal, immutable order. Internal: only tab_pay calls it.
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

  -- Stock was already decremented when each item was added: this only copies the lines, it never touches inventory.
  insert into public.order_items (order_id, product_id, variant_id, quantity, unit_price, discount, tax, total)
  select
    v_order_id, ti.product_id, ti.variant_id, ti.quantity, ti.unit_price, 0,
    round(ti.unit_price * ti.quantity * ti.tax_rate, v_scale),
    round(ti.unit_price * ti.quantity, v_scale) + round(ti.unit_price * ti.quantity * ti.tax_rate, v_scale)
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
-- open_tab: creates the tab and its initial people (a walk-in group with no names yet is fine).
-- ---------------------------------------------------------------------------
create or replace function public.open_tab(p_label text, p_customer_id uuid, p_members text[])
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_label  text := nullif(btrim(p_label), '');
  v_tab_id uuid;
  v_name   text;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_label is null then
    raise exception 'A label is required';
  end if;
  if length(v_label) > 120 then
    raise exception 'The label is too long';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from public.customers where id = p_customer_id and is_active) then
    raise exception 'Customer not available';
  end if;
  if p_members is not null and array_length(p_members, 1) > 50 then
    raise exception 'Too many people on one tab';
  end if;

  insert into public.tabs (tab_number, label, customer_id, opened_by)
  values ('TAB-' || lpad(nextval('public.tab_number_seq')::text, 6, '0'), v_label, p_customer_id, v_uid)
  returning id into v_tab_id;

  if p_members is not null then
    foreach v_name in array p_members loop
      v_name := nullif(btrim(v_name), '');
      if v_name is not null then
        insert into public.tab_members (tab_id, display_name) values (v_tab_id, v_name);
      end if;
    end loop;
  end if;

  return v_tab_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- tab_add_members: add people to split the bill with, any time before it closes.
-- ---------------------------------------------------------------------------
create or replace function public.tab_add_members(p_tab_id uuid, p_names text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_status public.tab_status;
  v_name   text;
  v_count  int;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_names is null or array_length(p_names, 1) is null then
    raise exception 'No one to add';
  end if;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open';
  end if;

  select count(*) into v_count from public.tab_members where tab_id = p_tab_id;

  foreach v_name in array p_names loop
    v_name := nullif(btrim(v_name), '');
    if v_name is not null then
      if v_count >= 50 then
        raise exception 'Too many people on one tab';
      end if;
      insert into public.tab_members (tab_id, display_name) values (p_tab_id, v_name);
      v_count := v_count + 1;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- tab_add_items: same validations as create_sale (price/tax from the database, atomic stock decrement); upserts
-- into tab_items instead of inserting order_items, and stamps inventory_transactions with the TAB id.
-- ---------------------------------------------------------------------------
create or replace function public.tab_add_items(p_tab_id uuid, p_items jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_status   public.tab_status;
  v_item     record;
  v_name     text;
  v_price    numeric(14, 2);
  v_tax_rate numeric;
  v_inv_id   uuid;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No items to add';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Too many items at once';
  end if;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open';
  end if;

  -- Sorted so concurrent additions (even on different tabs) lock inventory rows in the same order (no deadlocks).
  for v_item in
    select (e ->> 'product_id')::uuid                as product_id,
           nullif(e ->> 'variant_id', '')::uuid      as variant_id,
           (e ->> 'quantity')::int                   as quantity
    from jsonb_array_elements(p_items) e
    order by 1, 2 nulls first
  loop
    if v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Invalid quantity';
    end if;

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

    -- The price is a photo taken the first time: a repeat add only sums quantity, it never re-prices the line.
    insert into public.tab_items (tab_id, product_id, variant_id, quantity, unit_price, tax_rate, added_by)
    values (p_tab_id, v_item.product_id, v_item.variant_id, v_item.quantity, v_price, v_tax_rate, v_uid)
    on conflict (tab_id, product_id, variant_id)
    do update set quantity = public.tab_items.quantity + excluded.quantity, updated_at = now();

    insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, created_by)
    values (v_inv_id, 'sale', -v_item.quantity, p_tab_id, v_uid);
  end loop;

  update public.tabs set updated_at = now() where id = p_tab_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- tab_remove_item: manager+ only. Fails if the tab would end up owing less than what is already paid.
-- ---------------------------------------------------------------------------
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

  v_inv_id := null;
  update public.inventory
     set quantity = quantity + p_quantity
   where product_id = v_item.product_id
     and variant_id is not distinct from v_item.variant_id
  returning id into v_inv_id;
  if v_inv_id is not null then
    insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, notes, created_by)
    values (v_inv_id, 'return', p_quantity, p_tab_id, v_reason, v_uid);
  end if;

  update public.tabs set updated_at = now() where id = p_tab_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- tab_set_discount: same idea as the POS's order-level discount, but only while nothing has been paid yet (changing
-- the total after someone already paid their share would silently misprice the rest).
-- ---------------------------------------------------------------------------
create or replace function public.tab_set_discount(p_tab_id uuid, p_discount numeric)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_scale    int := public.money_scale();
  v_status   public.tab_status;
  v_discount numeric := coalesce(p_discount, 0);
  v_subtotal numeric(14, 2);
  v_tax      numeric(14, 2);
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_discount < 0 or v_discount <> round(v_discount, v_scale) then
    raise exception 'Invalid discount';
  end if;

  select status into v_status from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open';
  end if;
  if exists (select 1 from public.tab_payments where tab_id = p_tab_id) then
    raise exception 'The tab already has payments';
  end if;

  select subtotal, tax into v_subtotal, v_tax from public._tab_totals(p_tab_id);
  if v_discount > v_subtotal + v_tax then
    raise exception 'The discount exceeds the tab total';
  end if;

  update public.tabs set discount = v_discount, updated_at = now() where id = p_tab_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- tab_pay: the server computes the balance and rejects anything over it; closes the tab the moment it reaches 0.
-- ---------------------------------------------------------------------------
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
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
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

  insert into public.tab_payments (tab_id, member_id, payment_method, amount, created_by)
  values (p_tab_id, p_member_id, p_method, p_amount, v_uid);

  select balance into v_balance from public._tab_totals(p_tab_id);
  if v_balance <= 0 then
    perform public._close_tab(p_tab_id);
  else
    update public.tabs set updated_at = now() where id = p_tab_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_tab: manager+ only, and only before anyone has paid. Returns every item's stock.
-- ---------------------------------------------------------------------------
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

  for v_item in
    select product_id, variant_id, quantity from public.tab_items where tab_id = p_tab_id
    order by product_id, variant_id nulls first
  loop
    v_inv_id := null;
    update public.inventory
       set quantity = quantity + v_item.quantity
     where product_id = v_item.product_id
       and variant_id is not distinct from v_item.variant_id
    returning id into v_inv_id;
    if v_inv_id is not null then
      insert into public.inventory_transactions (inventory_id, transaction_type, quantity, reference_id, notes, created_by)
      values (v_inv_id, 'return', v_item.quantity, p_tab_id, v_reason, v_uid);
    end if;
  end loop;

  update public.tabs
     set status = 'voided', voided_by = v_uid, voided_at = now(), void_reason = v_reason, updated_at = now()
   where id = p_tab_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants: Supabase grants EXECUTE to anon by default on every new function; undo it, then open only to authenticated.
-- ---------------------------------------------------------------------------
revoke all on function
  public.tab_summary(uuid), public.open_tab(text, uuid, text[]), public.tab_add_members(uuid, text[]),
  public.tab_add_items(uuid, jsonb), public.tab_remove_item(uuid, uuid, int, text),
  public.tab_set_discount(uuid, numeric), public.tab_pay(uuid, uuid, public.payment_method, numeric),
  public.void_tab(uuid, text)
  from public, anon;
grant execute on function public.tab_summary(uuid) to authenticated;
grant execute on function public.open_tab(text, uuid, text[]) to authenticated;
grant execute on function public.tab_add_members(uuid, text[]) to authenticated;
grant execute on function public.tab_add_items(uuid, jsonb) to authenticated;
grant execute on function public.tab_remove_item(uuid, uuid, int, text) to authenticated;
grant execute on function public.tab_set_discount(uuid, numeric) to authenticated;
grant execute on function public.tab_pay(uuid, uuid, public.payment_method, numeric) to authenticated;
grant execute on function public.void_tab(uuid, text) to authenticated;
