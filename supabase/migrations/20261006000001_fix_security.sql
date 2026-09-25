-- R-A: security fixes (S1 list_receivables status/limit, A3 cash_session_summary ownership).
-- A2 (SSRF allowlist) and A4 (timing-safe cron secret) are TypeScript-only changes, no SQL here.

-- Signature changes (adds p_limit): drop the old 2-arg overload so PostgREST has one unambiguous `list_receivables`.
drop function if exists public.list_receivables(text, uuid);

create or replace function public.list_receivables(p_status text, p_customer_id uuid, p_limit int default 200)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz    text := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
    'UTC'
  );
  v_today date := (now() at time zone v_tz)::date;
  v_limit int := coalesce(p_limit, 200);
begin
  if (select auth.uid()) is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('pending', 'written_off') then
    raise exception 'Invalid status' using errcode = 'P0001';
  end if;
  if v_limit <= 0 or v_limit > 500 then
    raise exception 'Invalid limit' using errcode = 'P0001';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.due_date nulls last, t.order_number)
    from (
      select
        c.name as customer_name,
        ord.id as order_id,
        ord.order_number,
        ord.total,
        coalesce((select sum(p.amount) from public.payments p where p.order_id = ord.id), 0) as paid,
        ord.total - coalesce((select sum(p.amount) from public.payments p where p.order_id = ord.id), 0) as balance,
        ord.due_date,
        ord.reminder_enabled,
        ord.reminder_note,
        ord.status,
        case
          when ord.due_date is null or ord.due_date >= v_today then 0
          else (v_today - ord.due_date)
        end as days_overdue
      from public.orders ord
      left join public.customers c on c.id = ord.customer_id
      where (
          (p_status is null and ord.status in ('pending', 'written_off'))
          or (p_status is not null and ord.status::text = p_status)
        )
        and (p_customer_id is null or ord.customer_id = p_customer_id)
      order by ord.due_date nulls last, ord.order_number
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_receivables(text, uuid, int) from public, anon;
grant execute on function public.list_receivables(text, uuid, int) to authenticated;

-- A3: a cashier may only read cash sessions they are assigned to (`cash_session_users`); manager+ reads any.
create or replace function public.cash_session_summary(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cash jsonb;
  v_row  public.cash_sessions%rowtype;
  v_name text;
  v_uid  uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.cash_sessions where id = p_session_id;
  if not found then
    raise exception 'Cash session not found' using errcode = 'P0002';
  end if;
  if not public.has_min_role('manager')
     and not exists (
       select 1 from public.cash_session_users csu
       where csu.session_id = v_row.id and csu.user_id = v_uid
     ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select name into v_name from public.cash_registers where id = v_row.register_id;
  v_cash := public._session_cash(p_session_id);
  return v_cash || jsonb_build_object(
    'session_id', v_row.id,
    'register_id', v_row.register_id,
    'register_name', v_name,
    'status', v_row.status,
    'counted_cash', v_row.counted_cash,
    'difference', v_row.difference,
    'needs_review', v_row.needs_review,
    'opened_at', v_row.opened_at,
    'closed_at', v_row.closed_at
  );
end;
$$;
