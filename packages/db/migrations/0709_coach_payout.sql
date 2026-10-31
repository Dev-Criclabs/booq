-- F13-T10 / migration 0709: coach payouts. F13 design 3.4 and 4.8. Requirements: R3 (monthly payout report), D115 (only the owner marks
-- paid and adjusts), CC-1. Class D (BOOQ staff never). The pay model is F07's `coach_pay` (0802): an optional monthly base, and per
-- session pay for solo and group classes, fixed satang or basis points of the coaching portion. Nothing here supplies a value:
-- an unset pay setting leaves the amount null and flags the row, never a guess.
--   * Sessions delivered in a Bangkok month, by the coach who delivered them (a substituted class pays the substitute: F07 moves
--     booking.coach_id, and a group session carries its own coach):
--       solo: a solo_class booking, status `confirmed` with its hour over, or `no_show` (the customer attended or was a no show);
--             cancelled, late_cancelled, released and not yet played hours do not count;
--       group: a `scheduled` class session whose hour is over and that has at least one seat `confirmed` or `no_show`.
--   * solo pay: fixed = value per session; percent = basis points of the coaching portion, the net of the order's `coach` line of each
--     delivered booking (PRD: coach pay is calculated on the coaching portion only), rounded to the satang once on the month's sum.
--   * group pay: fixed = value per session. A percentage has no stated base for a group seat, so it is flagged `group_percent_no_base`
--     and the amount stays null until the owner decides (D147: no rule, no guess).
--   * Flags (the row's amount is null while any is set): solo_pay_unset, group_pay_unset, group_percent_no_base, solo_portion_missing
--     (a percent solo pay and a delivered booking with no coach line).
--   * amount = base + solo pay + group pay (a freelancer has no base: null base counts 0). Adjustments (owner only, reason required,
--     append only) are summed apart; the total owed is amount + adjustments. A paid month is frozen; a correction is an adjustment in
--     the next period, so adjusting a paid payout is refused.
-- The tables take no foreign key to coach, class_session or booking columns of later blocks (their migrations are numbered above this
-- one): the functions are plpgsql and read them when called. The coach is an app_user, so the key goes there.
-- Errors are payout:<code> (P0001): forbidden, invalid_month, coach_not_found, not_found, already_paid, reason_required, invalid_delta,
-- amount_unset, negative_total.

create table public.coach_payout (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  coach_id uuid not null,
  month date not null,
  status text not null default 'open',
  solo_sessions integer not null default 0,
  group_sessions integer not null default 0,
  sessions_delivered integer generated always as (solo_sessions + group_sessions) stored,
  base_satang integer,
  solo_pay_satang integer,
  group_pay_satang integer,
  flags text[] not null default '{}',
  amount_satang integer,
  computed_at timestamptz not null default app.now(),
  paid_by uuid,
  paid_at timestamptz,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, coach_id) references public.app_user (club_id, id),
  foreign key (club_id, paid_by) references public.app_user (club_id, id),
  constraint coach_payout_one_per_month unique (club_id, coach_id, month),
  constraint coach_payout_first_of_month check (extract(day from month) = 1),
  constraint coach_payout_status_values check (status in ('open', 'paid')),
  constraint coach_payout_counts check (solo_sessions >= 0 and group_sessions >= 0),
  constraint coach_payout_flags_values check (flags <@ array['solo_pay_unset', 'group_pay_unset', 'group_percent_no_base', 'solo_portion_missing']),
  constraint coach_payout_flagged_has_no_amount check ((cardinality(flags) = 0) = (amount_satang is not null)),
  constraint coach_payout_paid_shape check ((status = 'paid') = (paid_by is not null and paid_at is not null) and (status <> 'paid' or amount_satang is not null))
);

create table public.coach_payout_adjustment (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  payout_id uuid not null,
  coach_id uuid not null,
  delta_satang integer not null check (delta_satang <> 0),
  reason text not null check (btrim(reason) <> ''),
  staff_id uuid not null,
  created_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, payout_id) references public.coach_payout (club_id, id),
  foreign key (club_id, staff_id) references public.app_user (club_id, id)
);
create index coach_payout_adjustment_by_payout on public.coach_payout_adjustment (club_id, payout_id);

-- A test coach's rows are test rows (set from the person, like the coach tables of 0801).
create function app.copy_payout_is_test() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  new.is_test := coalesce((select u.is_test from public.app_user u where u.club_id = new.club_id and u.id = new.coach_id), false);
  return new;
end $$;
alter function app.copy_payout_is_test() owner to booq_owner;
revoke all on function app.copy_payout_is_test() from public;
create trigger is_test_copy before insert on public.coach_payout for each row execute function app.copy_payout_is_test();
create trigger is_test_copy before insert on public.coach_payout_adjustment for each row execute function app.copy_payout_is_test();

-- A payout changes only through the functions below (the owner role), and never once paid. Adjustments are append only.
create function app.coach_payout_guard() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if current_user = 'booq_owner' and old.status = 'open' and new.club_id = old.club_id and new.id = old.id and new.coach_id = old.coach_id and new.month = old.month then
    return new;
  end if;
  raise exception 'a coach payout changes only through its functions, and not once paid' using errcode = 'P0001';
end $$;
alter function app.coach_payout_guard() owner to booq_owner;
revoke all on function app.coach_payout_guard() from public;
create trigger coach_payout_no_edit before update on public.coach_payout for each row execute function app.coach_payout_guard();
create trigger coach_payout_no_delete before delete on public.coach_payout for each row execute function app.refuse_change();
create trigger coach_payout_no_truncate before truncate on public.coach_payout for each statement execute function app.refuse_change();
create trigger coach_payout_adjustment_no_change before update or delete on public.coach_payout_adjustment for each row execute function app.refuse_change();
create trigger coach_payout_adjustment_no_truncate before truncate on public.coach_payout_adjustment for each statement execute function app.refuse_change();

-- Rows and who reads: the owner and the accountant read the club's payouts and adjustments; nobody else reads them directly (a coach
-- reads their own through app.my_payouts). Nobody writes except the definer functions.
do $$
declare t text;
begin
  foreach t in array array['coach_payout', 'coach_payout_adjustment'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format('create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker using (club_id = app.club_id()) with check (club_id = app.club_id())', t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
    execute format('create policy %1$s_staff_read on public.%1$I for select to booq_app using (app.has_any_role(''owner'', ''accountant''))', t);
  end loop;
end $$;
grant select on public.coach_payout, public.coach_payout_adjustment to booq_app;

-- Test payouts go at Go live, before the coach pay and the coach they belong to (840, 850).
select app.register_test_table('public.coach_payout_adjustment', 838, false);
select app.register_test_table('public.coach_payout', 839, false);

-- The figures of one coach and month, written nowhere. Internal: no role is granted execute.
create function app.payout_figures(p_club uuid, p_coach uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_from timestamptz := p_month::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok';
  v_test boolean := coalesce((select u.is_test from public.app_user u where u.club_id = p_club and u.id = p_coach), false);
  pay record;
  v_solo integer;
  v_portion bigint;
  v_missing integer;
  v_group integer;
  v_flags text[] := '{}';
  v_solo_pay bigint;
  v_group_pay bigint;
  v_amount bigint;
begin
  select cp.monthly_base_satang, cp.solo_pay_kind, cp.solo_pay_value, cp.group_pay_kind, cp.group_pay_value into pay
    from public.coach_pay cp where cp.club_id = p_club and cp.coach_id = p_coach;

  select count(*)::integer, coalesce(sum(l.coach_net), 0), count(*) filter (where l.coach_net is null)::integer into v_solo, v_portion, v_missing
    from public.booking b
    left join lateral (select sum(ol.net_satang) as coach_net from public.order_line ol where ol.club_id = b.club_id and ol.booking_id = b.id and ol.kind = 'coach') l on true
   where b.club_id = p_club and b.type = 'solo_class' and b.coach_id = p_coach and b.is_test = v_test
     and b.start_at >= v_from and b.start_at < v_to
     and ((b.status = 'confirmed' and b.end_at <= app.now()) or b.status = 'no_show');

  select count(*)::integer into v_group
    from public.class_session s
   where s.club_id = p_club and s.coach_id = p_coach and s.is_test = v_test and s.status = 'scheduled'
     and s.start_at >= v_from and s.start_at < v_to and s.end_at <= app.now()
     and exists (select 1 from public.booking b where b.club_id = s.club_id and b.class_session_id = s.id and b.status in ('confirmed', 'no_show'));

  if v_solo = 0 then
    v_solo_pay := 0;
  elsif pay.solo_pay_kind is null then
    v_flags := v_flags || 'solo_pay_unset'::text;
  elsif pay.solo_pay_kind = 'fixed' then
    v_solo_pay := v_solo::bigint * pay.solo_pay_value;
  elsif v_missing > 0 then
    v_flags := v_flags || 'solo_portion_missing'::text;
  else
    v_solo_pay := round(v_portion * pay.solo_pay_value / 10000.0);
  end if;

  if v_group = 0 then
    v_group_pay := 0;
  elsif pay.group_pay_kind is null then
    v_flags := v_flags || 'group_pay_unset'::text;
  elsif pay.group_pay_kind = 'fixed' then
    v_group_pay := v_group::bigint * pay.group_pay_value;
  else
    v_flags := v_flags || 'group_percent_no_base'::text;
  end if;

  if cardinality(v_flags) = 0 then
    v_amount := coalesce(pay.monthly_base_satang, 0) + v_solo_pay + v_group_pay;
  end if;
  return jsonb_build_object('solo_sessions', v_solo, 'group_sessions', v_group, 'base_satang', pay.monthly_base_satang,
                            'solo_pay_satang', v_solo_pay, 'group_pay_satang', v_group_pay, 'flags', to_jsonb(v_flags), 'amount_satang', v_amount);
end $$;
alter function app.payout_figures(uuid, uuid, date) owner to booq_owner;
revoke all on function app.payout_figures(uuid, uuid, date) from public;

-- Stores the figures of an open payout (creating it), or returns a paid one untouched. Internal.
create function app.payout_store(p_club uuid, p_coach uuid, p_month date) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_id uuid;
  v_status text;
  f jsonb;
begin
  if not exists (select 1 from public.coach c where c.club_id = p_club and c.id = p_coach) then
    raise exception 'payout:coach_not_found' using errcode = 'P0001';
  end if;
  select p.id, p.status into v_id, v_status from public.coach_payout p where p.club_id = p_club and p.coach_id = p_coach and p.month = p_month for update;
  if v_status = 'paid' then
    return v_id;
  end if;
  f := app.payout_figures(p_club, p_coach, p_month);
  if v_id is null then
    insert into public.coach_payout (club_id, coach_id, month, solo_sessions, group_sessions, base_satang, solo_pay_satang, group_pay_satang, flags, amount_satang)
      values (p_club, p_coach, p_month, (f ->> 'solo_sessions')::integer, (f ->> 'group_sessions')::integer, (f ->> 'base_satang')::integer,
              (f ->> 'solo_pay_satang')::integer, (f ->> 'group_pay_satang')::integer, array(select jsonb_array_elements_text(f -> 'flags')), (f ->> 'amount_satang')::integer)
      returning id into v_id;
  else
    update public.coach_payout set solo_sessions = (f ->> 'solo_sessions')::integer, group_sessions = (f ->> 'group_sessions')::integer,
           base_satang = (f ->> 'base_satang')::integer, solo_pay_satang = (f ->> 'solo_pay_satang')::integer, group_pay_satang = (f ->> 'group_pay_satang')::integer,
           flags = array(select jsonb_array_elements_text(f -> 'flags')), amount_satang = (f ->> 'amount_satang')::integer, computed_at = app.now()
     where club_id = p_club and id = v_id;
  end if;
  return v_id;
end $$;
alter function app.payout_store(uuid, uuid, date) owner to booq_owner;
revoke all on function app.payout_store(uuid, uuid, date) from public;

create function app.payout_month_ok(p_month date) returns void
language plpgsql stable set search_path = pg_catalog
as $$
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'payout:invalid_month' using errcode = 'P0001';
  end if;
end $$;
alter function app.payout_month_ok(date) owner to booq_owner;
revoke all on function app.payout_month_ok(date) from public;

-- compute_payout: the owner or the accountant (read) computes and stores one coach's month.
create function app.compute_payout(p_coach uuid, p_month date) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or app.user_id() is null or not app.has_any_role('owner', 'accountant') then
    raise exception 'payout:forbidden' using errcode = 'P0001';
  end if;
  perform app.payout_month_ok(p_month);
  return app.payout_store(app.club_id(), p_coach, p_month);
end $$;
alter function app.compute_payout(uuid, date) owner to booq_owner;
revoke all on function app.compute_payout(uuid, date) from public;

-- payout_month: every coach with a payout, a delivered session or an active profile in the month, computed and listed.
create function app.payout_month(p_month date) returns table (
  payout_id uuid, coach_id uuid, coach_name text, status text, solo_sessions integer, group_sessions integer, base_satang integer,
  solo_pay_satang integer, group_pay_satang integer, flags text[], amount_satang integer, adjustments_satang bigint, total_satang bigint, paid_at timestamptz)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_from timestamptz := p_month::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := (p_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok';
  c record;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'accountant') then
    raise exception 'payout:forbidden' using errcode = 'P0001';
  end if;
  perform app.payout_month_ok(p_month);
  for c in
    select x.id from (
      select k.id from public.coach k where k.club_id = v_club and k.active
      union select p.coach_id from public.coach_payout p where p.club_id = v_club and p.month = p_month
      union select b.coach_id from public.booking b where b.club_id = v_club and b.type = 'solo_class' and b.coach_id is not null and b.start_at >= v_from and b.start_at < v_to
      union select s.coach_id from public.class_session s where s.club_id = v_club and s.start_at >= v_from and s.start_at < v_to
    ) x
    where exists (select 1 from public.coach k where k.club_id = v_club and k.id = x.id)
  loop
    perform app.payout_store(v_club, c.id, p_month);
  end loop;
  return query
    select p.id, p.coach_id, coalesce(u.full_name, u.display_name), p.status, p.solo_sessions, p.group_sessions, p.base_satang, p.solo_pay_satang, p.group_pay_satang,
           p.flags, p.amount_satang,
           coalesce((select sum(a.delta_satang) from public.coach_payout_adjustment a where a.club_id = p.club_id and a.payout_id = p.id), 0)::bigint,
           case when p.amount_satang is null then null
                else p.amount_satang + coalesce((select sum(a.delta_satang) from public.coach_payout_adjustment a where a.club_id = p.club_id and a.payout_id = p.id), 0) end::bigint,
           p.paid_at
      from public.coach_payout p
      join public.app_user u on u.club_id = p.club_id and u.id = p.coach_id
     where p.club_id = v_club and p.month = p_month
     order by coalesce(u.full_name, u.display_name), p.coach_id;
end $$;
alter function app.payout_month(date) owner to booq_owner;
revoke all on function app.payout_month(date) from public;

-- add_payout_adjustment: owner only; a reason is required; an open payout only.
create function app.add_payout_adjustment(p_payout uuid, p_delta integer, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  p public.coach_payout%rowtype;
  v_id uuid;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner') then
    raise exception 'payout:forbidden' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'payout:reason_required' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'payout:invalid_delta' using errcode = 'P0001';
  end if;
  select * into p from public.coach_payout where club_id = v_club and id = p_payout for update;
  if not found then
    raise exception 'payout:not_found' using errcode = 'P0001';
  end if;
  if p.status <> 'open' then
    raise exception 'payout:already_paid' using errcode = 'P0001';
  end if;
  insert into public.coach_payout_adjustment (club_id, payout_id, coach_id, delta_satang, reason, staff_id)
    values (v_club, p_payout, p.coach_id, p_delta, btrim(p_reason), app.user_id()) returning id into v_id;
  perform audit.note('payout.adjusted', 'coach_payout', p_payout, jsonb_build_object('coach_id', p.coach_id, 'month', p.month));
  return v_id;
end $$;
alter function app.add_payout_adjustment(uuid, integer, text) owner to booq_owner;
revoke all on function app.add_payout_adjustment(uuid, integer, text) from public;

-- mark_payout_paid: owner only (D115). The month is recomputed first so the paid figures are current, then frozen; refused while the
-- amount is unset or the total would be negative.
create function app.mark_payout_paid(p_payout uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  p public.coach_payout%rowtype;
  v_total bigint;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner') then
    raise exception 'payout:forbidden' using errcode = 'P0001';
  end if;
  select * into p from public.coach_payout where club_id = v_club and id = p_payout for update;
  if not found then
    raise exception 'payout:not_found' using errcode = 'P0001';
  end if;
  if p.status <> 'open' then
    raise exception 'payout:already_paid' using errcode = 'P0001';
  end if;
  perform app.payout_store(v_club, p.coach_id, p.month);
  select * into p from public.coach_payout where club_id = v_club and id = p_payout;
  if p.amount_satang is null then
    raise exception 'payout:amount_unset' using errcode = 'P0001';
  end if;
  select p.amount_satang + coalesce(sum(a.delta_satang), 0) into v_total from public.coach_payout_adjustment a where a.club_id = v_club and a.payout_id = p_payout;
  if v_total < 0 then
    raise exception 'payout:negative_total' using errcode = 'P0001';
  end if;
  update public.coach_payout set status = 'paid', paid_by = app.user_id(), paid_at = app.now() where club_id = v_club and id = p_payout;
  perform audit.note('payout.paid', 'coach_payout', p_payout, jsonb_build_object('coach_id', p.coach_id, 'month', p.month));
end $$;
alter function app.mark_payout_paid(uuid) owner to booq_owner;
revoke all on function app.mark_payout_paid(uuid) from public;

-- my_payouts: a coach reads their own month (K6): the stored row once paid, else the live figures, with the adjustments so far.
create function app.my_payouts(p_month date) returns table (
  month date, status text, solo_sessions integer, group_sessions integer, flags text[], amount_satang integer, adjustments_satang bigint, total_satang bigint, paid_at timestamptz)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_me uuid := app.user_id();
  p public.coach_payout%rowtype;
  f jsonb;
  v_adj bigint := 0;
  v_amount integer;
begin
  if v_club is null or v_me is null or not app.has_any_role('coach') or not exists (select 1 from public.coach c where c.club_id = v_club and c.id = v_me) then
    raise exception 'payout:forbidden' using errcode = 'P0001';
  end if;
  perform app.payout_month_ok(p_month);
  select * into p from public.coach_payout cp where cp.club_id = v_club and cp.coach_id = v_me and cp.month = p_month;
  if found then
    select coalesce(sum(a.delta_satang), 0) into v_adj from public.coach_payout_adjustment a where a.club_id = v_club and a.payout_id = p.id;
  end if;
  if found and p.status = 'paid' then
    return query select p_month, p.status, p.solo_sessions, p.group_sessions, p.flags, p.amount_satang, v_adj, p.amount_satang + v_adj, p.paid_at;
    return;
  end if;
  f := app.payout_figures(v_club, v_me, p_month);
  v_amount := (f ->> 'amount_satang')::integer;
  return query select p_month, 'open'::text, (f ->> 'solo_sessions')::integer, (f ->> 'group_sessions')::integer, array(select jsonb_array_elements_text(f -> 'flags')),
                      v_amount, v_adj, case when v_amount is null then null else v_amount + v_adj end::bigint, null::timestamptz;
end $$;
alter function app.my_payouts(date) owner to booq_owner;
revoke all on function app.my_payouts(date) from public;

grant execute on function app.compute_payout(uuid, date), app.payout_month(date), app.add_payout_adjustment(uuid, integer, text),
  app.mark_payout_paid(uuid), app.my_payouts(date) to booq_app;
