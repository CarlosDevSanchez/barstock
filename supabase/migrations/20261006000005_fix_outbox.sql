-- R-D: notifications reliability fixes (F2). F1 (afterResponse) and D3-D9 are TypeScript/UI changes without a
-- SQL component; F3 (per-recipient delivery), D3-D9 are not covered by this migration (see final report).

-- D2 (F2): _claim_outbox never reclaimed a row stuck in `claimed_at is not null` (a crashed/killed dispatch that
-- never reached markSuccess/markFailure), so it was permanently skipped. A row claimed more than 10 minutes ago
-- is treated as abandoned and reclaimed.
create or replace function public._claim_outbox(p_limit int)
returns setof public.notification_outbox
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select o.id
    from public.notification_outbox o
    where o.processed_at is null
      and o.attempts < 5
      and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
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

-- D2 (F2): dedup by "already enqueued today", not "still unprocessed" — a row stuck unprocessed from a prior day
-- (a permanent failure after 5 attempts still sets processed_at, but a crash before that does not) used to block
-- every future day's reminder for that order forever, on top of never being retried (fixed above).
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
        and (o.created_at at time zone v_tz)::date = v_today
    );
end;
$$;
