-- H6 second-pass follow-up: the items the "Pendiente" section of H6-revision-adversarial-a-f.md still listed
-- as not implemented (F3, U5, E2, E3). U6 and E1's siblings (E4-E7) and C6 are TypeScript/UI-only, no SQL here.

-- ---------------------------------------------------------------------------
-- F3: per-recipient/per-row delivery tracking, so a partial failure only re-sends to the recipients who did not
-- get it, instead of re-sending the whole batch to everyone (including those who already received it).
-- ---------------------------------------------------------------------------

create or replace function public._mark_outbox_delivery(p_ids bigint[], p_recipient uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.notification_outbox
     set payload = jsonb_set(
           coalesce(payload, '{}'::jsonb),
           '{delivered_to}',
           coalesce(payload -> 'delivered_to', '[]'::jsonb) || to_jsonb(p_recipient::text)
         )
   where id = any(p_ids)
     and not (coalesce(payload -> 'delivered_to', '[]'::jsonb) ? p_recipient::text);
end;
$$;

revoke all on function public._mark_outbox_delivery(bigint[], uuid) from public, anon, authenticated;
grant execute on function public._mark_outbox_delivery(bigint[], uuid) to service_role;

-- ---------------------------------------------------------------------------
-- U5: register_push_subscription upserts by endpoint and reassigns user_id to the caller, so a second user on a
-- shared/kiosk device subscribing with the browser's existing endpoint does not hit the `endpoint unique` 409 that
-- a plain insert produced (app/api/v1/me/push-subscriptions/route.ts used to delete-then-insert, which still
-- failed if the endpoint row belonged to a DIFFERENT user).
-- ---------------------------------------------------------------------------

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns public.push_subscriptions
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.push_subscriptions;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- E3: purge old, already-processed outbox rows so notification_outbox does not grow forever.
-- ---------------------------------------------------------------------------

create or replace function public._purge_outbox()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.notification_outbox
   where processed_at is not null
     and processed_at < now() - interval '30 days';
end;
$$;

revoke all on function public._purge_outbox() from public, anon, authenticated;
grant execute on function public._purge_outbox() to service_role;

-- ---------------------------------------------------------------------------
-- E2: expenses.occurred_at was backfilled assuming UTC (20261004000001_expenses.sql:48); recompute using the
-- business's actual timezone, but ONLY for rows still exactly at that UTC-derived value (a row edited or created
-- after the timezone was set has since diverged and is left untouched).
-- ---------------------------------------------------------------------------

do $$
declare
  v_tz text;
begin
  select coalesce((select s.value #>> '{}' from public.settings s where s.key = 'timezone'), 'UTC') into v_tz;
  if v_tz <> 'UTC' then
    update public.expenses
       set occurred_at = date::timestamp at time zone v_tz
     where occurred_at = date::timestamp at time zone 'UTC';
  end if;
end $$;
