-- Staff alerts (phase F): low-stock, auto-closed business days, receivable due dates.
-- Assumes orders.due_date and orders.reminder_enabled already exist (phase E, applied before this file).
-- Delivery is best-effort via notification_outbox; the app claims and sends (email/push).

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------

create table public.stock_alert_state (
  inventory_id     uuid primary key references public.inventory (id) on delete cascade,
  is_low           boolean not null default false,
  last_notified_at timestamptz
);

alter table public.stock_alert_state enable row level security;
revoke all on public.stock_alert_state from anon, authenticated;

create table public.notification_outbox (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('low_stock', 'business_day_auto_closed', 'receivable_due')),
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  claimed_at   timestamptz,
  attempts     int not null default 0,
  last_error   text
);

create index notification_outbox_pending_idx
  on public.notification_outbox (id)
  where processed_at is null and claimed_at is null;

alter table public.notification_outbox enable row level security;
-- No policies: only SECURITY DEFINER RPCs / service_role touch this table.
revoke all on public.notification_outbox from anon, authenticated;

create table public.push_subscriptions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: notification prefs (not writable via normal UPDATE)
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists notify_email boolean not null default true,
  add column if not exists notify_push boolean not null default true;

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

  -- notify_* only via set_notification_prefs (sets barstock.setting_notify_prefs for this txn).
  if (new.notify_email is distinct from old.notify_email
      or new.notify_push is distinct from old.notify_push)
     and coalesce(current_setting('barstock.setting_notify_prefs', true), '') <> '1' then
    raise exception 'notification prefs cannot be changed here' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.set_notification_prefs(p_email boolean, p_push boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform set_config('barstock.setting_notify_prefs', '1', true);
  update public.profiles
     set notify_email = coalesce(p_email, notify_email),
         notify_push = coalesce(p_push, notify_push)
   where id = v_uid;
end;
$$;

revoke all on function public.set_notification_prefs(boolean, boolean) from public, anon;
grant execute on function public.set_notification_prefs(boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- settings flag
-- ---------------------------------------------------------------------------

insert into public.settings (key, value)
values ('low_stock_notify_managers', 'false'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- low-stock trigger
-- ---------------------------------------------------------------------------

create or replace function public._inventory_low_stock_notify()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_was_low boolean;
  v_now_low boolean := new.quantity <= new.low_stock_threshold;
begin
  select s.is_low into v_was_low
  from public.stock_alert_state s
  where s.inventory_id = new.id;

  if v_now_low then
    if coalesce(v_was_low, false) is not true then
      insert into public.notification_outbox (kind, payload)
      values (
        'low_stock',
        jsonb_build_object(
          'inventory_id', new.id,
          'product_id', new.product_id,
          'quantity', new.quantity,
          'threshold', new.low_stock_threshold
        )
      );
      insert into public.stock_alert_state (inventory_id, is_low, last_notified_at)
      values (new.id, true, now())
      on conflict (inventory_id) do update
        set is_low = true,
            last_notified_at = now();
    end if;
  elsif coalesce(v_was_low, false) then
    insert into public.stock_alert_state (inventory_id, is_low, last_notified_at)
    values (new.id, false, null)
    on conflict (inventory_id) do update
      set is_low = false;
  end if;

  return new;
end;
$$;

revoke all on function public._inventory_low_stock_notify() from public, anon, authenticated;

drop trigger if exists inventory_low_stock_notify on public.inventory;
create trigger inventory_low_stock_notify
  after update of quantity, low_stock_threshold on public.inventory
  for each row
  execute function public._inventory_low_stock_notify();

-- ---------------------------------------------------------------------------
-- auto-close: enqueue one row per day actually closed
-- ---------------------------------------------------------------------------

create or replace function public._auto_close_stale_business_days()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_day   record;
  v_close timestamptz;
begin
  for v_day in
    select id, opened_at from public.business_days
    where closed_at is null and opened_at < now() - interval '24 hours'
    for update
  loop
    v_close := v_day.opened_at + interval '24 hours';
    update public.cash_sessions cs
       set status = 'closed',
           closed_at = greatest(v_close, cs.opened_at + interval '1 millisecond'),
           needs_review = true,
           counted_cash = null,
           expected_cash = (public._session_cash(cs.id) ->> 'expected_cash')::numeric,
           difference = null
     where cs.business_day_id = v_day.id and cs.status = 'open';
    update public.business_days
       set closed_at = v_close, close_kind = 'auto', needs_review = true
     where id = v_day.id;
    insert into public.notification_outbox (kind, payload)
    values (
      'business_day_auto_closed',
      jsonb_build_object('business_day_id', v_day.id, 'closed_at', v_close)
    );
  end loop;
end;
$$;

revoke all on function public._auto_close_stale_business_days() from public, anon, authenticated;
grant execute on function public._auto_close_stale_business_days() to service_role;

-- ---------------------------------------------------------------------------
-- receivables due (phase E columns): enqueue at most once per order per store-local day
-- ---------------------------------------------------------------------------

create or replace function public._enqueue_due_receivables()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_today date;
begin
  v_tz := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
    'UTC'
  );
  v_today := (now() at time zone v_tz)::date;

  insert into public.notification_outbox (kind, payload)
  select 'receivable_due', jsonb_build_object('order_id', ord.id)
  from public.orders ord
  where ord.status = 'pending'
    and ord.reminder_enabled
    and ord.due_date is not null
    and ord.due_date <= v_today
    and not exists (
      select 1
      from public.notification_outbox o
      where o.kind = 'receivable_due'
        and o.payload ->> 'order_id' = ord.id::text
        and (
          o.processed_at is null
          or (o.processed_at at time zone v_tz)::date = v_today
        )
    );
end;
$$;

revoke all on function public._enqueue_due_receivables() from public, anon, authenticated;
grant execute on function public._enqueue_due_receivables() to service_role;

-- ---------------------------------------------------------------------------
-- claim outbox rows (SKIP LOCKED); caller marks processed after send
-- ---------------------------------------------------------------------------

create or replace function public._claim_outbox(p_limit int)
returns setof public.notification_outbox
language plpgsql security definer
set search_path = ''
as $$
begin
  -- UPDATE ... RETURNING keeps the claim across the RPC commit (plain SELECT FOR UPDATE
  -- releases the lock when the function returns, so concurrent callers would see the same rows).
  return query
  with picked as (
    select o.id
    from public.notification_outbox o
    where o.processed_at is null
      and o.claimed_at is null
      and o.attempts < 5
    order by o.id
    for update of o skip locked
    limit least(coalesce(p_limit, 50), 50)
  )
  update public.notification_outbox n
     set claimed_at = now()
    from picked
   where n.id = picked.id
  returning n.*;
end;
$$;

revoke all on function public._claim_outbox(int) from public, anon, authenticated;
grant execute on function public._claim_outbox(int) to service_role;
