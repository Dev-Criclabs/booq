-- F13-T07 / migration 0705: daily_close, app.daily_close_totals, app.preview_daily_close, app.run_daily_close. F13 design 3.3, 4.2, 4.6.
-- Requirements: RCPT-03-AC1 to AC10; decisions D33, D35, D37, D79, D119. Class D.
--   * The day is a Bangkok day: midnight to midnight, so a payment at 23:59 belongs to that day and one at 00:00 to the next.
--   * Money received is totalled from payment (succeeded, confirmed in the day, not test) by method, never by adding up receipts (4.2).
--     A payment whose receipt is void at the time of the close is not counted and is listed as void. A late or wrong amount payment is
--     counted in the method it arrived by and is also listed as credited to the wallet.
--   * Credit use and wallet use are separate non money lines (D119): credit use is the credit_ledger `use` rows of the day, each
--     priced at its package's price per credit (the price paid, frozen in the package snapshot, over the credits it holds; an
--     imported package has no price and counts as 0); wallet use is the `spend` rows of the day and
--     wallet returned is the `return` rows.
--   * A void made in the day is listed on that day, whenever the receipt was issued (D119); it never reopens an earlier day.
--   * Test rows are left out (D33). A close run in a Testing club is itself a test row and goes at Go live.
--   * A closed day is immutable: one row per club and day, append-only. A payment reported late, or a void, belongs to the day it
--     is made (RCPT-03-AC9, AC10).
--   * Owner and accountant only, from the context. The accountant sees totals, receipt numbers and customer names, no contact data.
--   Errors are close:<code> (P0001): forbidden, invalid_day, day_not_over, already_closed.

create table public.daily_close (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  day date not null,
  run_by uuid not null,
  run_at timestamptz not null default app.now(),
  totals jsonb not null,
  receipt_count integer not null check (receipt_count >= 0),
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, run_by) references public.app_user (club_id, id),
  constraint daily_close_one_per_day unique (club_id, day),
  constraint daily_close_totals_shape check (jsonb_typeof(totals) = 'object')
);
create trigger daily_close_append_only before update or delete on public.daily_close for each row execute function app.refuse_change();
create trigger daily_close_no_truncate before truncate on public.daily_close for each statement execute function app.refuse_change();
alter table public.daily_close owner to booq_owner;
alter table public.daily_close enable row level security;
alter table public.daily_close force row level security;
revoke all on public.daily_close from public;
create policy daily_close_tenant on public.daily_close as restrictive for all to booq_app, booq_worker using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy daily_close_definer on public.daily_close for all to booq_owner using (true) with check (true);
create policy daily_close_read on public.daily_close for select to booq_app using (app.has_any_role('owner', 'accountant'));
grant select on public.daily_close to booq_app;
select app.register_test_table('public.daily_close', 256);

-- The numbers of one day. Internal: no role is granted execute; the two entry points below check the caller.
create function app.daily_close_totals(p_club uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_from timestamptz := p_day::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_day + 1)::timestamp at time zone 'Asia/Bangkok';
  v_beam bigint;
  v_cash bigint;
  v_voided_pay jsonb;
  v_credit jsonb;
  v_wallet_used bigint;
  v_wallet_returned bigint;
  v_wallet_credited jsonb;
  v_receipts jsonb;
  v_voids jsonb;
begin
  -- Payments received in the day, with the state of their receipt now.
  with pay as (
    select p.method, p.amount_satang as amount, r.number as receipt_number, r.status as receipt_status
      from public.payment p
      left join lateral (
        select rr.number, rr.status from public.receipt rr
         where rr.club_id = p.club_id and ((rr.kind = 'sale' and rr.order_id = p.order_id) or (rr.kind = 'wallet_credit' and rr.payment_id = p.id))
         order by rr.issued_at limit 1) r on true
     where p.club_id = p_club and p.status = 'succeeded' and not p.is_test and p.confirmed_at >= v_from and p.confirmed_at < v_to)
  select coalesce(sum(amount) filter (where method = 'beam' and receipt_status is distinct from 'void'), 0),
         coalesce(sum(amount) filter (where method = 'cash' and receipt_status is distinct from 'void'), 0),
         coalesce(jsonb_agg(jsonb_build_object('number', receipt_number, 'method', method, 'amount_satang', amount) order by receipt_number) filter (where receipt_status = 'void'), '[]'::jsonb)
    into v_beam, v_cash, v_voided_pay from pay;

  select jsonb_build_object('count', count(*), 'value_satang', coalesce(round(sum(coalesce((pk.product_snapshot ->> 'price_satang')::numeric, 0) / pk.credits_total)), 0)::bigint)
    into v_credit
    from public.credit_ledger u
    join public.customer_package pk on pk.club_id = u.club_id and pk.id = u.package_id
   where u.club_id = p_club and u.reason = 'use' and not u.is_test and u.created_at >= v_from and u.created_at < v_to;

  select coalesce(sum(-w.change_satang) filter (where w.reason = 'spend'), 0), coalesce(sum(w.change_satang) filter (where w.reason = 'return'), 0)
    into v_wallet_used, v_wallet_returned
    from public.wallet_ledger w where w.club_id = p_club and not w.is_test and w.created_at >= v_from and w.created_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('reason', w.reason, 'amount_satang', w.change_satang, 'receipt_number', r.number) order by w.created_at, w.id), '[]'::jsonb)
    into v_wallet_credited
    from public.wallet_ledger w
    left join public.receipt r on r.club_id = w.club_id and r.kind = 'wallet_credit' and r.payment_id = w.payment_id
   where w.club_id = p_club and not w.is_test and w.reason in ('late_payment', 'wrong_amount', 'duplicate_payment')
     and w.created_at >= v_from and w.created_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('number', r.number, 'kind', r.kind, 'status', r.status, 'customer_name', r.customer_name_snapshot, 'total_satang', r.total_satang) order by r.issued_at, r.id), '[]'::jsonb)
    into v_receipts from public.receipt r where r.club_id = p_club and not r.is_test and r.issued_at >= v_from and r.issued_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object('number', r.number, 'total_satang', r.total_satang, 'reason', v.reason) order by v.voided_at, v.id), '[]'::jsonb)
    into v_voids
    from public.receipt_void v join public.receipt r on r.club_id = v.club_id and r.id = v.receipt_id
   where v.club_id = p_club and not v.is_test and v.voided_at >= v_from and v.voided_at < v_to;

  return jsonb_build_object(
    'day', p_day,
    'methods', jsonb_build_object('beam', v_beam, 'cash', v_cash),
    'money_total_satang', v_beam + v_cash,
    'voided_payments', v_voided_pay,
    'credit_used', v_credit,
    'wallet_used_satang', v_wallet_used,
    'wallet_returned_satang', v_wallet_returned,
    'wallet_credited', v_wallet_credited,
    'receipts', v_receipts,
    'voids_made', v_voids);
end $$;
alter function app.daily_close_totals(uuid, date) owner to booq_owner;
revoke all on function app.daily_close_totals(uuid, date) from public;

create function app.close_caller() returns uuid
language plpgsql stable set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or app.user_id() is null or not app.has_any_role('owner', 'accountant') then
    raise exception 'close:forbidden' using errcode = 'P0001';
  end if;
  return app.club_id();
end $$;
alter function app.close_caller() owner to booq_owner;
revoke all on function app.close_caller() from public;

-- Preview: the same numbers for any day, today included, writing nothing.
create function app.preview_daily_close(p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.close_caller();
begin
  if p_day is null then
    raise exception 'close:invalid_day' using errcode = 'P0001';
  end if;
  return app.daily_close_totals(v_club, p_day);
end $$;

create function app.run_daily_close(p_day date) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.close_caller();
  v_totals jsonb;
  v_id uuid;
begin
  if p_day is null then
    raise exception 'close:invalid_day' using errcode = 'P0001';
  end if;
  if p_day >= (app.now() at time zone 'Asia/Bangkok')::date then
    raise exception 'close:day_not_over' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.daily_close c where c.club_id = v_club and c.day = p_day) then
    raise exception 'close:already_closed' using errcode = 'P0001';
  end if;
  v_totals := app.daily_close_totals(v_club, p_day);
  insert into public.daily_close (club_id, day, run_by, totals, receipt_count)
    values (v_club, p_day, app.user_id(), v_totals, jsonb_array_length(v_totals -> 'receipts'))
    returning id into v_id;
  perform audit.note('daily_close.run', 'daily_close', v_id, jsonb_build_object('day', p_day, 'receipt_count', jsonb_array_length(v_totals -> 'receipts')));
  return v_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.preview_daily_close(date)', 'app.run_daily_close(date)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
