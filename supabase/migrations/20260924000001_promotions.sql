-- Promotions (fixed multi-product packages): catalog tables + order_items.promotion_id for sale-line grouping.
-- Soft-delete mirrors products (deleted_at + is_active); no hard delete from the API (history via order_items FK).
-- Writes to order_items still go only through SECURITY DEFINER RPCs (create_sale will expand packages later).

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.promotions (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null check (btrim(name) <> ''),
  package_price  numeric(14, 2) not null check (package_price >= 0),
  is_active      boolean not null default true,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index promotions_not_deleted_idx
  on public.promotions (created_at desc)
  where deleted_at is null;

create trigger update_promotions_updated_at
  before update on public.promotions
  for each row execute function update_updated_at_column();

create table public.promotion_items (
  id            uuid primary key default uuid_generate_v4(),
  promotion_id  uuid not null references public.promotions (id) on delete cascade,
  product_id    uuid not null references public.products (id),
  quantity      int not null check (quantity >= 1),
  created_at    timestamptz not null default now(),
  unique (promotion_id, product_id)
);

create index promotion_items_promotion_idx on public.promotion_items (promotion_id);
create index promotion_items_product_idx on public.promotion_items (product_id);

-- Nullable FK without ON DELETE CASCADE: soft-deleted promos stay reachable from historical lines;
-- hard delete of a referenced promo is blocked by the FK (and there is no DELETE policy below).
alter table public.order_items
  add column promotion_id uuid references public.promotions (id);

create index order_items_promotion_idx
  on public.order_items (promotion_id)
  where promotion_id is not null;

-- ---------------------------------------------------------------------------
-- RLS (cashier+ read active; managers see soft-deleted; manager+ write; no hard delete)
-- ---------------------------------------------------------------------------
alter table public.promotions enable row level security;
alter table public.promotion_items enable row level security;

create policy promotions_select on public.promotions for select to authenticated
  using ((select public.has_min_role('cashier'))
         and (deleted_at is null or (select public.has_min_role('manager'))));
create policy promotions_insert on public.promotions for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy promotions_update on public.promotions for update to authenticated
  using ((select public.has_min_role('manager')))
  with check ((select public.has_min_role('manager')));
-- no DELETE policy: soft-delete only (keeps order_items.promotion_id valid)

create policy promotion_items_select on public.promotion_items for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy promotion_items_insert on public.promotion_items for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy promotion_items_update on public.promotion_items for update to authenticated
  using ((select public.has_min_role('manager')))
  with check ((select public.has_min_role('manager')));
create policy promotion_items_delete on public.promotion_items for delete to authenticated
  using ((select public.has_min_role('manager')));

revoke all on public.promotions, public.promotion_items from anon;
revoke truncate, references, trigger on public.promotions, public.promotion_items from authenticated;
revoke delete on public.promotions from authenticated;
