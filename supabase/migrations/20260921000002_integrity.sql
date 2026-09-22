-- 0002 integrity: CHECK constraints, NOT NULLs, indexes, soft delete and activation columns.
--
-- On an EXISTING database run the integrity queries of docs/05-guias/verificar-checkout.md first: the plain
-- constraints below fail if bad rows exist. The two arithmetic checks are NOT VALID so legacy orders (computed
-- client-side with inconsistent taxes, see H3) do not block the migration; VALIDATE them after cleaning the data.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade;

update public.profiles set role = 'cashier' where role is null;
alter table public.profiles
  alter column role set not null,
  add column is_active boolean not null default true;

-- ---------------------------------------------------------------------------
-- catalog
-- ---------------------------------------------------------------------------
update public.products set tax_rate = 0 where tax_rate is null;
update public.products set is_active = true where is_active is null;
alter table public.products
  alter column tax_rate type numeric(6, 4),
  alter column tax_rate set default 0,
  alter column tax_rate set not null,
  alter column is_active set not null,
  add column deleted_at timestamptz,
  add constraint products_cost_price_check check (cost_price >= 0),
  add constraint products_selling_price_check check (selling_price >= 0),
  add constraint products_tax_rate_check check (tax_rate between 0 and 1);

alter table public.product_variants
  alter column product_id set not null,
  add constraint product_variants_cost_price_check check (cost_price is null or cost_price >= 0),
  add constraint product_variants_selling_price_check check (selling_price is null or selling_price >= 0);

-- ---------------------------------------------------------------------------
-- inventory
-- ---------------------------------------------------------------------------
update public.inventory set low_stock_threshold = 0 where low_stock_threshold is null;
alter table public.inventory
  alter column product_id set not null,
  alter column low_stock_threshold set not null,
  add constraint inventory_quantity_check check (quantity >= 0),
  add constraint inventory_low_stock_threshold_check check (low_stock_threshold >= 0);

-- UNIQUE (product_id, variant_id) does not stop duplicates when variant_id is NULL.
create unique index inventory_product_without_variant_key on public.inventory (product_id) where variant_id is null;

alter table public.inventory_transactions
  alter column inventory_id set not null,
  add constraint inventory_transactions_type_check
    check (transaction_type in ('purchase', 'sale', 'adjustment', 'return')),
  add constraint inventory_transactions_quantity_check check (quantity <> 0);

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------
update public.customers set is_active = true where is_active is null;
update public.customers set loyalty_points = 0 where loyalty_points is null;
update public.customers set total_spent = 0 where total_spent is null;
alter table public.customers
  alter column is_active set not null,
  alter column loyalty_points set not null,
  alter column total_spent set not null,
  add constraint customers_loyalty_points_check check (loyalty_points >= 0),
  add constraint customers_total_spent_check check (total_spent >= 0);

update public.suppliers set is_active = true where is_active is null;
alter table public.suppliers alter column is_active set not null;

-- ---------------------------------------------------------------------------
-- purchasing (schema only; no UI yet)
-- ---------------------------------------------------------------------------
alter table public.purchase_orders
  add constraint purchase_orders_total_amount_check check (total_amount >= 0);

alter table public.purchase_order_items
  alter column purchase_order_id set not null,
  alter column product_id set not null,
  add constraint purchase_order_items_quantity_check check (quantity > 0),
  add constraint purchase_order_items_unit_price_check check (unit_price >= 0);

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------
update public.orders set discount = 0 where discount is null;
update public.orders set tax = 0 where tax is null;
update public.orders set status = 'pending' where status is null;
alter table public.orders
  alter column status set not null,
  alter column discount set not null,
  alter column tax set not null,
  add constraint orders_amounts_check check (subtotal >= 0 and discount >= 0 and tax >= 0 and total >= 0),
  add constraint orders_total_matches check (total = subtotal - discount + tax) not valid;

update public.order_items set discount = 0 where discount is null;
update public.order_items set tax = 0 where tax is null;
alter table public.order_items
  alter column order_id set not null,
  alter column product_id set not null,
  alter column discount set not null,
  alter column tax set not null,
  add constraint order_items_quantity_check check (quantity > 0),
  add constraint order_items_amounts_check check (unit_price >= 0 and discount >= 0 and tax >= 0 and total >= 0),
  add constraint order_items_total_matches check (total = unit_price * quantity - discount + tax) not valid;

alter table public.payments
  alter column order_id set not null,
  add constraint payments_amount_check check (amount >= 0);

alter table public.expenses add constraint expenses_amount_check check (amount >= 0);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
-- products.sku and products.barcode are UNIQUE (already indexed).
drop index if exists public.idx_products_sku;
drop index if exists public.idx_products_barcode;

create index idx_orders_status_created_at on public.orders (status, created_at);
create index idx_orders_created_by_created_at on public.orders (created_by, created_at);
create index idx_order_items_product on public.order_items (product_id);
create index idx_inventory_variant on public.inventory (variant_id) where variant_id is not null;
create index idx_inventory_transactions_inventory_created on public.inventory_transactions (inventory_id, created_at);
create index idx_inventory_transactions_reference on public.inventory_transactions (reference_id);
create index idx_product_variants_product on public.product_variants (product_id);
create index idx_categories_parent on public.categories (parent_id);
create index idx_purchase_order_items_order on public.purchase_order_items (purchase_order_id);

-- ---------------------------------------------------------------------------
-- audit timestamps are never null (they have defaults; the nullable declaration only made generated types sloppy)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public' and column_name in ('created_at', 'updated_at') and is_nullable = 'YES'
  loop
    execute format('update public.%I set %I = now() where %I is null', r.table_name, r.column_name, r.column_name);
    execute format('alter table public.%I alter column %I set not null', r.table_name, r.column_name);
  end loop;
end;
$$;
