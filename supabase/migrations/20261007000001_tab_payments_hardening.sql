-- Task C (parte 3.2): tab payment hardening.
--
-- tab_pay_split gets the same "distinct payment methods" guard create_sale/pay_receivable already enforce (B7),
-- and both tab_pay/tab_pay_split gain an OPTIONAL p_idempotency_key (unlike pay_receivable's mandatory header —
-- the POS UI can retry a tab payment safely without one for now, so the client isn't forced to upgrade in
-- lockstep; see app/api/v1/tabs/[id]/payments/route.ts). Reuses public.idempotency_keys exactly like
-- create_sale/pay_receivable do: insert-on-conflict, replay the stored result on a matching retry, raise BS409
-- on a same-key/different-payload collision.
--
-- Also: listTabs needs each tab's running balance without an N+1 RPC loop (lib/server/services/tabs.ts). Rather
-- than a per-row `tab_summary`/`_tab_totals` call, expose a PostgREST "computed column" — a function taking the
-- `tabs` row and returning its balance — so `tabsApi.list` can select it in the same query as the FK embed to
-- `customers`, set-based, no extra round trips.

-- ---------------------------------------------------------------------------
-- tab_pay: add p_idempotency_key (optional). A single payment can't have a duplicate-method problem, so only the
-- idempotency handling is added here.
-- ---------------------------------------------------------------------------
-- A new parameter with a default does not replace the old signature, it overloads it (the old grants would still
-- stand) — drop the old signature explicitly first, same as create_sale in 20260927000001_idempotency.sql.
drop function public.tab_pay(uuid, uuid, public.payment_method, numeric);

create or replace function public.tab_pay(
  p_tab_id uuid,
  p_member_id uuid,
  p_method public.payment_method,
  p_amount numeric,
  p_idempotency_key uuid default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_scale   int := public.money_scale();
  v_status  public.tab_status;
  v_balance numeric(14, 2);
  v_cash_session_id uuid;
  v_current_status  text;
  v_request_hash    text;
  v_existing_user   uuid;
  v_existing_hash   text;
  v_existing_result jsonb;
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

  if p_idempotency_key is not null then
    v_request_hash := md5(
      p_tab_id::text || '|' || coalesce(p_member_id::text, '') || '|' || p_method::text || '|' || p_amount::text
    );

    insert into public.idempotency_keys (key, user_id, action, request_hash)
    values (p_idempotency_key, v_uid, 'tab_pay', v_request_hash)
    on conflict (key) do nothing;

    if not found then
      select user_id, request_hash, result
        into v_existing_user, v_existing_hash, v_existing_result
      from public.idempotency_keys
      where key = p_idempotency_key;

      if v_existing_user is not distinct from v_uid and v_existing_hash is not distinct from v_request_hash
         and v_existing_result is not null then
        return;
      end if;
      raise exception 'This payment was already submitted, refresh and try again' using errcode = 'BS409';
    end if;
  end if;

  perform public._auto_close_stale_business_days();
  select a.cash_session_id into v_cash_session_id
    from public._current_assignment(v_uid, now()) a;
  if v_cash_session_id is not null then
    select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
    if v_current_status is distinct from 'open' then
      v_cash_session_id := null;
    end if;
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

  insert into public.tab_payments (tab_id, member_id, payment_method, amount, created_by, cash_session_id)
  values (p_tab_id, p_member_id, p_method, p_amount, v_uid, v_cash_session_id);

  select balance into v_balance from public._tab_totals(p_tab_id);
  if v_balance <= 0 then
    perform public._close_tab(p_tab_id);
  else
    update public.tabs set updated_at = now() where id = p_tab_id;
  end if;

  if p_idempotency_key is not null then
    update public.idempotency_keys
       set result = jsonb_build_object('ok', true)
     where key = p_idempotency_key;
  end if;
end;
$$;

revoke all on function public.tab_pay(uuid, uuid, public.payment_method, numeric, uuid) from public, anon;
grant execute on function public.tab_pay(uuid, uuid, public.payment_method, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- tab_pay_split: reject duplicate payment methods (B7, mirroring create_sale/pay_receivable) + optional
-- p_idempotency_key.
-- ---------------------------------------------------------------------------
drop function public.tab_pay_split(uuid, uuid, jsonb);

create or replace function public.tab_pay_split(
  p_tab_id uuid,
  p_member_id uuid,
  p_payments jsonb,
  p_idempotency_key uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_scale   int := public.money_scale();
  v_status  public.tab_status;
  v_balance numeric(14, 2);
  v_pay     jsonb;
  v_count   int;
  v_sum     numeric(14, 2) := 0;
  v_amount  numeric(14, 2);
  v_method  public.payment_method;
  v_methods text[] := '{}';
  v_cash_session_id uuid;
  v_current_status  text;
  v_request_hash    text;
  v_existing_user   uuid;
  v_existing_hash   text;
  v_existing_result jsonb;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payments) is distinct from 'array' then
    raise exception 'Invalid payments' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_payments);
  if v_count < 1 or v_count > 2 then
    raise exception 'Invalid payments' using errcode = 'P0001';
  end if;

  for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
  loop
    if (v_pay ->> 'method') is null or (v_pay ->> 'method') not in ('cash', 'card', 'ewallet') then
      raise exception 'Invalid payment method' using errcode = 'P0001';
    end if;
    v_method := (v_pay ->> 'method')::public.payment_method;
    if v_method::text = any (v_methods) then
      raise exception 'Payment methods must be distinct' using errcode = 'P0001';
    end if;
    v_methods := array_append(v_methods, v_method::text);
    v_amount := (v_pay ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, v_scale) then
      raise exception 'Invalid amount' using errcode = 'P0001';
    end if;
    v_sum := v_sum + v_amount;
  end loop;

  if p_idempotency_key is not null then
    v_request_hash := md5(p_tab_id::text || '|' || coalesce(p_member_id::text, '') || '|' || p_payments::text);

    insert into public.idempotency_keys (key, user_id, action, request_hash)
    values (p_idempotency_key, v_uid, 'tab_pay_split', v_request_hash)
    on conflict (key) do nothing;

    if not found then
      select user_id, request_hash, result
        into v_existing_user, v_existing_hash, v_existing_result
      from public.idempotency_keys
      where key = p_idempotency_key;

      if v_existing_user is not distinct from v_uid and v_existing_hash is not distinct from v_request_hash
         and v_existing_result is not null then
        return;
      end if;
      raise exception 'This payment was already submitted, refresh and try again' using errcode = 'BS409';
    end if;
  end if;

  perform public._auto_close_stale_business_days();
  select a.cash_session_id into v_cash_session_id
    from public._current_assignment(v_uid, now()) a;
  if v_cash_session_id is not null then
    select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
    if v_current_status is distinct from 'open' then
      v_cash_session_id := null;
    end if;
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
  if v_sum > v_balance then
    raise exception 'The amount exceeds the balance' using errcode = 'P0001';
  end if;

  for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
  loop
    insert into public.tab_payments (tab_id, member_id, payment_method, amount, created_by, cash_session_id)
    values (
      p_tab_id,
      p_member_id,
      (v_pay ->> 'method')::public.payment_method,
      (v_pay ->> 'amount')::numeric,
      v_uid,
      v_cash_session_id
    );
  end loop;

  select balance into v_balance from public._tab_totals(p_tab_id);
  if v_balance <= 0 then
    perform public._close_tab(p_tab_id);
  else
    update public.tabs set updated_at = now() where id = p_tab_id;
  end if;

  if p_idempotency_key is not null then
    update public.idempotency_keys
       set result = jsonb_build_object('ok', true)
     where key = p_idempotency_key;
  end if;
end;
$$;

revoke all on function public.tab_pay_split(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.tab_pay_split(uuid, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- listTabs balance: a PostgREST "computed column" on `tabs` (a function taking the table's row type), so
-- lib/server/services/tabs.ts can select it in the same query as the `customer` FK embed — no per-row RPC loop.
-- SECURITY DEFINER because `_tab_totals` itself is revoked from authenticated/anon (only SECURITY DEFINER RPCs
-- may call it). PostgREST auto-exposes any single-table-arg function both as a computed column AND as a direct
-- `/rpc/balance` endpoint, so — same as `tab_summary`/`tab_pay`/`tab_pay_split` above it — it needs its OWN
-- `has_min_role('cashier')` check: without one, a grant to `authenticated` alone would let any signed-in user
-- read any tab's balance straight through `/rpc/balance`, bypassing the `tabs` RLS policy entirely.
-- ---------------------------------------------------------------------------
create or replace function public.balance(t public.tabs)
returns numeric
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return (select balance from public._tab_totals(t.id));
end;
$$;

revoke all on function public.balance(public.tabs) from public, anon;
grant execute on function public.balance(public.tabs) to authenticated;
