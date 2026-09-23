-- 0016 audit log: who did what and when. Admin-only reads, append-only for everybody (including service_role and the
-- SQL editor). Covers writes to the tables that matter for accountability plus session events (login/logout/invite/
-- password reset). Excludes order_items, payments and inventory_transactions: redundant with orders/inventory rows.
--
-- Immutability is enforced in three independent layers (any one of them failing still leaves the other two):
--   1. RLS: only a SELECT policy exists.
--   2. Table privileges: INSERT/UPDATE/DELETE/TRUNCATE revoked from authenticated/anon (service_role keeps INSERT,
--      used by log_auth_event's login_failed path, which runs before there is a session to attach to).
--   3. BEFORE UPDATE/DELETE/TRUNCATE triggers that raise unconditionally: these fire for service_role and the SQL
--      editor too, which table privileges alone would not stop.

-- ---------------------------------------------------------------------------
-- table
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  -- No FK: a record must survive the actor being deleted later.
  actor_id     uuid,
  actor_email  text,
  actor_role   public.user_role,
  action       text not null check (action in
                 ('insert', 'update', 'delete', 'login', 'login_failed', 'logout', 'invite', 'password_reset')),
  entity       text not null,
  entity_id    text,
  -- New row on insert, old row on delete, only the changed columns (before/after) on update. Never updated_at.
  changes      jsonb,
  source       text not null check (source in ('db', 'api'))
);

create index audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at);
create index audit_log_entity_idx on public.audit_log (entity, occurred_at);

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.has_min_role('admin')));
-- No INSERT/UPDATE/DELETE policy: writes happen only through the triggers/RPC below (SECURITY DEFINER, which run as
-- the function owner and so are not subject to RLS at all).

revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;

-- Belt and suspenders: blocks UPDATE/DELETE/TRUNCATE from ANY role, including service_role and a superuser running
-- ad hoc SQL. This is the layer that actually makes the table append-only.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;
revoke all on function public.audit_log_immutable() from public, anon, authenticated;

drop trigger if exists audit_log_no_update_delete on public.audit_log;
create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- generic trigger: records INSERT/UPDATE/DELETE on the tables it is attached to below
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_actor_email text;
  v_entity_id text;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_key text;
begin
  if v_actor_id is null then
    -- No JWT: a migration, seed, service_role write, or the SQL editor. Recorded as "system", never left blank.
    v_actor_email := 'system';
    v_actor_role := null;
  else
    select role, email into v_actor_role, v_actor_email from public.profiles where id = v_actor_id;
  end if;

  if TG_OP = 'INSERT' then
    v_entity_id := to_jsonb(NEW) ->> 'id';
    v_changes := to_jsonb(NEW) - 'updated_at';
  elsif TG_OP = 'DELETE' then
    v_entity_id := to_jsonb(OLD) ->> 'id';
    v_changes := to_jsonb(OLD) - 'updated_at';
  else
    v_entity_id := to_jsonb(NEW) ->> 'id';
    v_old := to_jsonb(OLD) - 'updated_at';
    v_new := to_jsonb(NEW) - 'updated_at';
    v_changes := '{}'::jsonb;
    for v_key in select jsonb_object_keys(v_new) loop
      if v_old -> v_key is distinct from v_new -> v_key then
        v_changes := v_changes
          || jsonb_build_object(v_key, jsonb_build_object('before', v_old -> v_key, 'after', v_new -> v_key));
      end if;
    end loop;
    -- Nothing actually changed (e.g. a no-op UPDATE): do not log it.
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_email, actor_role, action, entity, entity_id, changes, source)
  values (
    v_actor_id,
    v_actor_email,
    v_actor_role,
    lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    v_changes,
    case when v_actor_id is null then 'db' else 'api' end
  );

  return null;
end;
$$;
revoke all on function public.audit_row_change() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'categories', 'promotions', 'promotion_items', 'inventory', 'orders', 'customers', 'suppliers',
    'settings', 'profiles', 'tabs', 'tab_items', 'tab_payments'
  ]
  loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I '
      || 'for each row execute function public.audit_row_change()',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- session events, logged from the API (no direct table write happens for these)
-- ---------------------------------------------------------------------------
create or replace function public.log_auth_event(p_action text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role public.user_role;
  v_actor_email text;
begin
  if p_action not in ('login', 'logout', 'invite', 'password_reset') then
    raise exception 'invalid auth event' using errcode = '22023';
  end if;
  -- The actor is always the caller's own JWT: never a parameter, so nobody can log an event as someone else.
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select role, email into v_actor_role, v_actor_email from public.profiles where id = v_actor_id;

  insert into public.audit_log (actor_id, actor_email, actor_role, action, entity, entity_id, changes, source)
  values (v_actor_id, v_actor_email, v_actor_role, p_action, 'auth', v_actor_id::text, p_metadata, 'api');
end;
$$;
revoke all on function public.log_auth_event(text, jsonb) from public, anon;
grant execute on function public.log_auth_event(text, jsonb) to authenticated;
