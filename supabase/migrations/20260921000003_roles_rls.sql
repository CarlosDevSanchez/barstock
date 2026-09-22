-- 0003 roles and RLS: per-role policies, profile protection, closed-by-default signup, no direct writes to sales/stock.
--
-- Roles are hierarchical: admin >= manager >= cashier. A user with profiles.is_active = false has NO role
-- (current_app_role() is null), so no policy passes for them.

-- ---------------------------------------------------------------------------
-- helpers (SECURITY DEFINER: they read profiles regardless of the caller's RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and is_active
$$;

create or replace function public.has_min_role(p_minimum public.user_role)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    case public.current_app_role() when 'admin' then 3 when 'manager' then 2 when 'cashier' then 1 end
      >= case p_minimum when 'admin' then 3 when 'manager' then 2 when 'cashier' then 1 end,
    false)
$$;

-- Supabase grants EXECUTE on new public functions to anon by default: undo it.
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.has_min_role(public.user_role) from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_min_role(public.user_role) to authenticated;

-- ---------------------------------------------------------------------------
-- new users: closed by default
-- ---------------------------------------------------------------------------
-- The role is read ONLY from app_metadata, which just the server (service_role / auth.admin) can set. user_metadata is
-- editable by the user and is never trusted. A profile is active only when the server assigned a role; anyone else
-- (e.g. a public signup on a project where signup is still open) gets an INACTIVE cashier profile with no access.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text := new.raw_app_meta_data ->> 'role';
  v_valid boolean := coalesce(v_role in ('admin', 'manager', 'cashier'), false);
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    case when v_valid then v_role::public.user_role else 'cashier' end,
    v_valid
  );
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- GoTrue's admin API inserts the user first and writes app_metadata in a later UPDATE, so the INSERT trigger above
-- cannot see a role assigned through `auth.admin.createUser({ app_metadata })`. This trigger applies it, but only when the
-- `role` key itself changes: an unrelated app_metadata update must never revert a role change or reactivate a user.
create or replace function public.sync_profile_role_from_app_metadata()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text := new.raw_app_meta_data ->> 'role';
begin
  if v_role in ('admin', 'manager', 'cashier') then
    update public.profiles set role = v_role::public.user_role, is_active = true where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_profile_role_from_app_metadata() from public, anon, authenticated;

drop trigger if exists on_auth_user_app_metadata_role_changed on auth.users;
create trigger on_auth_user_app_metadata_role_changed
  after update of raw_app_meta_data on auth.users
  for each row
  when ((old.raw_app_meta_data ->> 'role') is distinct from (new.raw_app_meta_data ->> 'role'))
  execute function public.sync_profile_role_from_app_metadata();

-- ---------------------------------------------------------------------------
-- profiles: only admins change role / is_active; nobody changes id / email through the API
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- No user in the JWT (SQL editor, migrations, service_role): the server is trusted.
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'id and email cannot be changed' using errcode = '42501';
  end if;

  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not public.has_min_role('admin') then
    raise exception 'only admins can change roles or activation' using errcode = '42501';
  end if;

  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.profiles where role = 'admin' and is_active and id <> old.id) then
    raise exception 'The last active admin cannot be demoted or deactivated';
  end if;

  return new;
end;
$$;
revoke all on function public.protect_profile_columns() from public, anon, authenticated;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- drop EVERY existing policy (schema.sql ones and anything fix_rls_policies.sql created on a deployed database)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

-- RLS on for every table (idempotent)
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.settings enable row level security;

-- ---------------------------------------------------------------------------
-- policies. `(select …)` makes Postgres evaluate the role once per statement, not per row.
-- ---------------------------------------------------------------------------

-- profiles: everyone sees their own; managers+ see all; admins update anyone (the trigger restricts what non-admins change)
create policy profiles_select on public.profiles for select to authenticated
  using ((select public.has_min_role('cashier'))
         and (id = (select auth.uid()) or (select public.has_min_role('manager'))));
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.has_min_role('cashier'))
         and (id = (select auth.uid()) or (select public.has_min_role('admin'))))
  with check ((select public.has_min_role('cashier'))
              and (id = (select auth.uid()) or (select public.has_min_role('admin'))));
-- no INSERT (the auth trigger creates profiles) and no DELETE (deactivate instead)

-- categories
create policy categories_select on public.categories for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy categories_insert on public.categories for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy categories_update on public.categories for update to authenticated
  using ((select public.has_min_role('manager'))) with check ((select public.has_min_role('manager')));
create policy categories_delete on public.categories for delete to authenticated
  using ((select public.has_min_role('manager')));

-- products: cashiers do not see soft-deleted ones; "delete" by managers is UPDATE deleted_at; hard delete is admin-only
create policy products_select on public.products for select to authenticated
  using ((select public.has_min_role('cashier'))
         and (deleted_at is null or (select public.has_min_role('manager'))));
create policy products_insert on public.products for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy products_update on public.products for update to authenticated
  using ((select public.has_min_role('manager'))) with check ((select public.has_min_role('manager')));
create policy products_delete on public.products for delete to authenticated
  using ((select public.has_min_role('admin')));

-- product_variants
create policy product_variants_select on public.product_variants for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy product_variants_insert on public.product_variants for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy product_variants_update on public.product_variants for update to authenticated
  using ((select public.has_min_role('manager'))) with check ((select public.has_min_role('manager')));
create policy product_variants_delete on public.product_variants for delete to authenticated
  using ((select public.has_min_role('admin')));

-- inventory / inventory_transactions: read-only from the API; writes happen in the RPCs (SECURITY DEFINER)
create policy inventory_select on public.inventory for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy inventory_transactions_select on public.inventory_transactions for select to authenticated
  using ((select public.has_min_role('manager')));

-- suppliers and purchasing: managers and admins
create policy suppliers_select on public.suppliers for select to authenticated
  using ((select public.has_min_role('manager')));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy suppliers_update on public.suppliers for update to authenticated
  using ((select public.has_min_role('manager'))) with check ((select public.has_min_role('manager')));
create policy suppliers_delete on public.suppliers for delete to authenticated
  using ((select public.has_min_role('admin')));

create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using ((select public.has_min_role('manager')));
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using ((select public.has_min_role('manager'))) with check ((select public.has_min_role('manager')));
create policy purchase_orders_delete on public.purchase_orders for delete to authenticated
  using ((select public.has_min_role('admin')));

create policy purchase_order_items_select on public.purchase_order_items for select to authenticated
  using ((select public.has_min_role('manager')));
create policy purchase_order_items_insert on public.purchase_order_items for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy purchase_order_items_update on public.purchase_order_items for update to authenticated
  using ((select public.has_min_role('manager'))) with check ((select public.has_min_role('manager')));
create policy purchase_order_items_delete on public.purchase_order_items for delete to authenticated
  using ((select public.has_min_role('admin')));

-- customers: any active user reads and edits (columns limited below); only admins delete
create policy customers_select on public.customers for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy customers_insert on public.customers for insert to authenticated
  with check ((select public.has_min_role('cashier')));
create policy customers_update on public.customers for update to authenticated
  using ((select public.has_min_role('cashier'))) with check ((select public.has_min_role('cashier')));
create policy customers_delete on public.customers for delete to authenticated
  using ((select public.has_min_role('admin')));

-- orders: cashiers see their own, managers+ see all. No write policies: only create_sale / refund_order write.
create policy orders_select on public.orders for select to authenticated
  using ((select public.has_min_role('cashier'))
         and (created_by = (select auth.uid()) or (select public.has_min_role('manager'))));
-- children inherit the parent's visibility (the subquery is itself filtered by orders_select)
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = payments.order_id));

-- expenses: managers read and create; admins edit and delete
create policy expenses_select on public.expenses for select to authenticated
  using ((select public.has_min_role('manager')));
create policy expenses_insert on public.expenses for insert to authenticated
  with check ((select public.has_min_role('manager')));
create policy expenses_update on public.expenses for update to authenticated
  using ((select public.has_min_role('admin'))) with check ((select public.has_min_role('admin')));
create policy expenses_delete on public.expenses for delete to authenticated
  using ((select public.has_min_role('admin')));

-- settings: everyone reads (currency, store name), only admins write
create policy settings_select on public.settings for select to authenticated
  using ((select public.has_min_role('cashier')));
create policy settings_insert on public.settings for insert to authenticated
  with check ((select public.has_min_role('admin')));
create policy settings_update on public.settings for update to authenticated
  using ((select public.has_min_role('admin'))) with check ((select public.has_min_role('admin')));
create policy settings_delete on public.settings for delete to authenticated
  using ((select public.has_min_role('admin')));

-- ---------------------------------------------------------------------------
-- table privileges (defense in depth: RLS is not the only barrier)
-- ---------------------------------------------------------------------------
-- Supabase default privileges hand every new public object to anon/authenticated/service_role. Nothing here is for anon.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- TRUNCATE bypasses RLS; REFERENCES/TRIGGER are never needed by API users.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Sales and stock change only through SECURITY DEFINER RPCs.
revoke insert, update, delete on
  public.orders, public.order_items, public.payments, public.inventory, public.inventory_transactions
  from authenticated;

-- Loyalty and total_spent are derived from orders (0004): clients may only write the descriptive columns.
revoke insert, update on public.customers from authenticated;
grant insert (name, email, phone, address, is_active), update (name, email, phone, address, is_active)
  on public.customers to authenticated;
