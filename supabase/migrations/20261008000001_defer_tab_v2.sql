-- Task D (parte 4): defer_tab v2 — optional customer / free-text debtor name / initial partial payment.
--
-- Precondition (verified against local seed + existing defer_tab): every status = 'pending' order already has a
-- customer_id, so orders_pending_needs_debtor_check can be added without rewriting rows.
--
-- Security: has_min_role runs as the first statement of every new/replaced function body, before settings reads,
-- idempotency_keys, SELECT FOR UPDATE, or list queries. Do not move data access above that guard.

alter table public.orders add column debtor_name text null;
alter table public.orders add constraint orders_debtor_name_check
  check (debtor_name is null or length(btrim(debtor_name)) between 2 and 120);
alter table public.orders add constraint orders_pending_needs_debtor_check
  check (status <> 'pending' or customer_id is not null or debtor_name is not null);

-- Postgres CHECK cannot be DEFERRABLE, so debtor_name must be present on INSERT. The plan wanted
-- defer_tab to set it after _create_order_from_tab; that insert would fail the new check when the
-- tab has no customer. Optional p_debtor_name keeps the helper's other callers unchanged.
drop function public._create_order_from_tab(uuid, public.order_status);

create or replace function public._create_order_from_tab(
  p_tab_id uuid,
  p_status public.order_status,
  p_debtor_name text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_scale    int;
  v_tab      record;
  v_totals   record;
  v_order_id uuid;
  v_business_day_id uuid;
  v_cash_session_id uuid;
  v_current_status  text;
begin
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_scale := public.money_scale();
  perform public._auto_close_stale_business_days();
  select a.business_day_id, a.cash_session_id
    into v_business_day_id, v_cash_session_id
    from public._current_assignment(v_uid, now()) a;
  if v_cash_session_id is not null then
    select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
    if v_current_status is distinct from 'open' then
      v_cash_session_id := null;
    end if;
  end if;
  select * into v_tab from public.tabs where id = p_tab_id;
  select * into v_totals from public._tab_totals(p_tab_id);

  insert into public.orders (
    order_number, customer_id, status, tab_id, created_by, subtotal, discount, tax, total,
    business_day_id, cash_session_id, settled_at, debtor_name
  )
  values (
    'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),
    v_tab.customer_id, p_status, p_tab_id, v_uid,
    v_totals.subtotal, v_totals.discount, v_totals.tax, v_totals.total,
    v_business_day_id, v_cash_session_id,
    case when p_status = 'completed' then now() else null end,
    nullif(btrim(p_debtor_name), '')
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, variant_id, quantity, unit_price, discount, tax, total, tax_rate, promotion_id, unit_cost
  )
  select
    v_order_id,
    ti.product_id,
    ti.variant_id,
    ti.quantity,
    ti.unit_price,
    ti.discount,
    round((ti.unit_price * ti.quantity - ti.discount) * ti.tax_rate, v_scale),
    (ti.unit_price * ti.quantity - ti.discount)
      + round((ti.unit_price * ti.quantity - ti.discount) * ti.tax_rate, v_scale),
    ti.tax_rate,
    ti.promotion_id,
    (select coalesce(v.cost_price, p.cost_price) from public.products p
       left join public.product_variants v on v.id = ti.variant_id
      where p.id = ti.product_id)
  from public.tab_items ti
  where ti.tab_id = p_tab_id;

  insert into public.payments (order_id, payment_method, amount, created_by, business_day_id, cash_session_id)
  select
    v_order_id,
    tp.payment_method,
    tp.amount,
    tp.created_by,
    coalesce((select cs.business_day_id from public.cash_sessions cs where cs.id = tp.cash_session_id), v_business_day_id),
    tp.cash_session_id
  from public.tab_payments tp
  where tp.tab_id = p_tab_id;

  update public.tabs
     set status = 'closed', order_id = v_order_id, closed_by = v_uid, closed_at = now(), updated_at = now()
   where id = p_tab_id;

  return v_order_id;
end;
$$;

revoke all on function public._create_order_from_tab(uuid, public.order_status, text) from public, anon, authenticated;

drop function public.defer_tab(uuid, date, boolean, text);

create or replace function public.defer_tab(
  p_tab_id uuid,
  p_due_date date,
  p_reminder boolean,
  p_note text,
  p_customer_id uuid default null,
  p_debtor_name text default null,
  p_payments jsonb default null,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_scale   int;
  v_tz      text;
  v_today   date;
  v_status  public.tab_status;
  v_tab_customer uuid;
  v_customer uuid;
  v_debtor  text;
  v_balance numeric(14, 2);
  v_order_id uuid;
  v_pay     jsonb;
  v_pay_count int;
  v_pay_sum numeric(14, 2) := 0;
  v_pay_amount numeric(14, 2);
  v_pay_method public.payment_method;
  v_methods text[] := '{}';
  v_cash_session_id uuid;
  v_current_status text;
  v_request_hash text;
  v_existing_user uuid;
  v_existing_hash text;
  v_existing_result jsonb;
begin
  -- Role check FIRST — before settings, idempotency, locks, or writes.
  if v_uid is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  perform public._auto_close_stale_business_days();

  if p_idempotency_key is not null then
    v_request_hash := md5(
      p_tab_id::text || '|' || coalesce(p_due_date::text, '') || '|' || coalesce(p_payments::text, '')
    );

    insert into public.idempotency_keys (key, user_id, action, request_hash)
    values (p_idempotency_key, v_uid, 'defer_tab', v_request_hash)
    on conflict (key) do nothing;

    if not found then
      select user_id, request_hash, result
        into v_existing_user, v_existing_hash, v_existing_result
      from public.idempotency_keys
      where key = p_idempotency_key;

      if v_existing_user is not distinct from v_uid and v_existing_hash is not distinct from v_request_hash
         and v_existing_result is not null then
        return (v_existing_result ->> 'order_id')::uuid;
      end if;
      raise exception 'This sale was already submitted, refresh and try again' using errcode = 'BS409';
    end if;
  end if;

  select status, customer_id into v_status, v_tab_customer
  from public.tabs where id = p_tab_id for update;
  if not found then
    raise exception 'Tab not found' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'The tab is not open' using errcode = 'P0001';
  end if;

  if p_customer_id is not null then
    select id into v_customer
      from public.customers
     where id = p_customer_id
       and deleted_at is null
       and is_active;
    if v_customer is null then
      raise exception 'Customer not found or inactive' using errcode = 'P0001';
    end if;
    update public.tabs set customer_id = v_customer, updated_at = now() where id = p_tab_id;
    v_debtor := null;
  elsif v_tab_customer is not null then
    v_customer := v_tab_customer;
    v_debtor := null;
  else
    v_debtor := nullif(btrim(p_debtor_name), '');
    if v_debtor is null then
      raise exception 'A customer or debtor name is required' using errcode = 'P0001';
    end if;
    if length(v_debtor) < 2 or length(v_debtor) > 120 then
      raise exception 'Invalid debtor name' using errcode = 'P0001';
    end if;
    v_customer := null;
  end if;

  v_tz := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
    'UTC'
  );
  v_today := (now() at time zone v_tz)::date;
  if p_due_date is not null and p_due_date < v_today then
    raise exception 'Due date cannot be in the past' using errcode = 'P0001';
  end if;

  select balance into v_balance from public._tab_totals(p_tab_id);
  if v_balance is null or v_balance <= 0 then
    raise exception 'Nothing left to defer' using errcode = 'P0001';
  end if;

  if p_payments is not null then
    v_scale := public.money_scale();
    if jsonb_typeof(p_payments) is distinct from 'array' then
      raise exception 'Invalid payments' using errcode = 'P0001';
    end if;
    v_pay_count := jsonb_array_length(p_payments);
    if v_pay_count < 1 or v_pay_count > 2 then
      raise exception 'Invalid payments' using errcode = 'P0001';
    end if;

    for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
    loop
      if (v_pay ->> 'method') is null
         or (v_pay ->> 'method') not in ('cash', 'card', 'ewallet') then
        raise exception 'Invalid payment method' using errcode = 'P0001';
      end if;
      v_pay_method := (v_pay ->> 'method')::public.payment_method;
      if v_pay_method::text = any (v_methods) then
        raise exception 'Payment methods must be distinct' using errcode = 'P0001';
      end if;
      v_methods := array_append(v_methods, v_pay_method::text);
      v_pay_amount := (v_pay ->> 'amount')::numeric;
      if v_pay_amount is null or v_pay_amount <= 0 or v_pay_amount <> round(v_pay_amount, v_scale) then
        raise exception 'Invalid amount' using errcode = 'P0001';
      end if;
      v_pay_sum := v_pay_sum + v_pay_amount;
    end loop;

    if v_pay_sum >= v_balance then
      raise exception 'The amount must be less than the balance' using errcode = 'P0001';
    end if;

    select a.cash_session_id into v_cash_session_id
      from public._current_assignment(v_uid, now()) a;
    if v_cash_session_id is not null then
      select status into v_current_status from public.cash_sessions where id = v_cash_session_id for share;
      if v_current_status is distinct from 'open' then
        v_cash_session_id := null;
      end if;
    end if;

    for v_pay in select value from jsonb_array_elements(p_payments) as t(value)
    loop
      insert into public.tab_payments (tab_id, member_id, payment_method, amount, created_by, cash_session_id)
      values (
        p_tab_id,
        null,
        (v_pay ->> 'method')::public.payment_method,
        (v_pay ->> 'amount')::numeric,
        v_uid,
        v_cash_session_id
      );
    end loop;
  end if;

  v_order_id := public._create_order_from_tab(p_tab_id, 'pending', v_debtor);

  update public.orders
     set due_date = p_due_date,
         reminder_enabled = coalesce(p_reminder, false),
         reminder_note = nullif(btrim(p_note), ''),
         debtor_name = v_debtor
   where id = v_order_id;

  if p_idempotency_key is not null then
    update public.idempotency_keys
       set result = jsonb_build_object('order_id', v_order_id)
     where key = p_idempotency_key;
  end if;

  return v_order_id;
end;
$$;

revoke all on function public.defer_tab(uuid, date, boolean, text, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.defer_tab(uuid, date, boolean, text, uuid, text, jsonb, uuid) to authenticated;

drop function public.list_receivables(text, uuid, int);

create or replace function public.list_receivables(
  p_status text,
  p_customer_id uuid,
  p_q text default null,
  p_limit int default 200
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz    text;
  v_today date;
  v_limit int;
  v_q     text;
begin
  -- Role check FIRST — before settings or the list query.
  if (select auth.uid()) is null or not public.has_min_role('cashier') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('pending', 'written_off') then
    raise exception 'Invalid status' using errcode = 'P0001';
  end if;
  v_limit := coalesce(p_limit, 200);
  if v_limit <= 0 or v_limit > 500 then
    raise exception 'Invalid limit' using errcode = 'P0001';
  end if;

  v_tz := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'timezone'),
    'UTC'
  );
  v_today := (now() at time zone v_tz)::date;
  v_q := nullif(btrim(p_q), '');

  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.due_date nulls last, t.order_number)
    from (
      select
        coalesce(c.name, ord.debtor_name) as customer_name,
        ord.debtor_name,
        ord.customer_id,
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
        and (
          v_q is null
          or coalesce(c.name, ord.debtor_name) ilike '%' || v_q || '%'
        )
      order by ord.due_date nulls last, ord.order_number
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_receivables(text, uuid, text, int) from public, anon;
grant execute on function public.list_receivables(text, uuid, text, int) to authenticated;
