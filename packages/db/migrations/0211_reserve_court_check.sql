-- F03-T07 / migration 0211: the checks that run before a court is claimed. F03 design 4.2 steps
-- 1 to 7 and 9. Requirements: BOOK-01, BOOK-03-AC2, BOOK-06. Decisions D39, D42, D60. Review SR-07.
-- reserve_court (T08) calls app.reserve_court_check first and then claims. Everything is
-- decided here, in the database, inside the booking transaction; the client only shows.
--
-- Refusals are typed: SQLSTATE BK001 with the code as the message (no text, CC-5). The API maps
-- a code to a locale key.

-- The definer functions run as booq_owner, which sees a row only through a policy (forced RLS).
-- Read access to the setup tables they consult; every function filters by app.club_id() itself.
create policy club_setting_definer_read on public.club_setting for select to booq_owner using (true);
create policy resource_definer_read on public.resource for select to booq_owner using (true);
create policy opening_hours_definer_read on public.opening_hours for select to booq_owner using (true);

create function app.refuse(p_code text) returns void
language plpgsql set search_path = pg_catalog
as $$ begin raise exception '%', p_code using errcode = 'BK001'; end $$;
alter function app.refuse(text) owner to booq_owner;
revoke all on function app.refuse(text) from public;

-- A club setting as text, or null when unset (a Blank template club). Never a default.
create function app.club_setting_text(p_key text) returns text
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select value #>> '{}' from public.club_setting where club_id = app.club_id() and key = p_key $$;
alter function app.club_setting_text(text) owner to booq_owner;
revoke all on function app.club_setting_text(text) from public;

-- The hold time in minutes (T05, D52): 10, 15 or 20, or null when unset. F16 will make this
-- return 60 in backup mode; nothing else reads the setting.
create function app.hold_minutes() returns integer
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare v text := app.club_setting_text('hold_minutes');
begin
  if v is null or v = '' then return null; end if;
  if v not in ('10', '15', '20') then
    raise exception 'hold_minutes must be 10, 15 or 20' using errcode = '22023';
  end if;
  return v::integer;
end $$;
alter function app.hold_minutes() owner to booq_owner;
revoke all on function app.hold_minutes() from public;
grant execute on function app.hold_minutes() to booq_app, booq_worker;

-- Testers of an unlaunched club: the owner now; the named BOOQ testers when club_tester exists
-- (F01-T12, migration 0003). Written against to_regclass so it works before and after.
create function app.is_club_tester() returns boolean
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare v boolean := false;
begin
  if app.has_any_role('owner') then return true; end if;
  if app.user_id() is not null and to_regclass('public.club_tester') is not null then
    execute 'select exists (select 1 from public.club_tester where club_id = $1 and user_id = $2 and removed_at is null)'
      into v using app.club_id(), app.user_id();
  end if;
  return coalesce(v, false);
end $$;
alter function app.is_club_tester() owner to booq_owner;
revoke all on function app.is_club_tester() from public;
grant execute on function app.is_club_tester() to booq_app, booq_worker;

-- Returns {customer_id, source, staff} for the caller, or raises a typed refusal. Locks nothing.
create function app.reserve_court_check(
  p_order uuid, p_resource uuid, p_starts timestamptz[], p_coach uuid, p_override_reason text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_now timestamptz := app.now();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_status text;
  v_ord public.orders%rowtype;
  v_sorted timestamptz[];
  v_n integer;
  v_window integer;
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  s timestamptz;
  v_first date;
  v_min integer;
  v_open_min integer;
  v_close_min integer;
  v_open time;
  v_close time;
  i integer;
begin
  -- 1. Context (BOOK-03-AC2, BOOK-01-AC10, D60).
  if v_club is null then perform app.refuse('club_not_available'); end if;
  if v_user is null or not app.has_any_role('player', 'coach', 'front_desk', 'accountant', 'owner') then
    perform app.refuse('sign_in_required');
  end if;
  select status into v_status from public.club where id = v_club;
  if v_status is null then perform app.refuse('club_not_available'); end if;
  if v_status = 'paused' then perform app.refuse('club_paused'); end if;
  if v_status in ('draft', 'testing') and not app.is_club_tester() then perform app.refuse('club_not_available'); end if;
  if v_status not in ('draft', 'testing', 'live') then perform app.refuse('club_not_available'); end if;

  -- The order: this club's, and the caller's own unless the caller is staff (SR-07).
  select * into v_ord from public.orders where club_id = v_club and id = p_order;
  if not found then perform app.refuse('order_not_found'); end if;
  if not v_staff and (v_ord.customer_id is distinct from v_user or v_ord.source <> 'online') then
    perform app.refuse('order_not_found');
  end if;
  if p_override_reason is not null and not v_staff then perform app.refuse('forbidden'); end if;

  -- 3. Selection shape (BOOK-01-AC1, AC2, AC11, BOOK-06).
  v_n := coalesce(cardinality(p_starts), 0);
  if v_n = 0 then perform app.refuse('not_consecutive'); end if;
  select array_agg(x order by x) into v_sorted from unnest(p_starts) x;
  foreach s in array v_sorted loop
    if extract(minute from s at time zone 'Asia/Bangkok') <> 0
       or extract(second from s at time zone 'Asia/Bangkok') <> 0 then
      perform app.refuse('not_on_the_hour');
    end if;
  end loop;
  for i in 2 .. v_n loop
    if v_sorted[i] - v_sorted[i - 1] <> interval '1 hour' then perform app.refuse('not_consecutive'); end if;
  end loop;
  v_first := (v_sorted[1] at time zone 'Asia/Bangkok')::date;
  if (v_sorted[v_n] at time zone 'Asia/Bangkok')::date <> v_first then perform app.refuse('not_consecutive'); end if;

  -- 4. Opening hours of that weekday; the last hour must end by closing (23:00 is the last start,
  --    24:00 is never a start, D39).
  select open, close into v_open, v_close from public.opening_hours
   where club_id = v_club and weekday = extract(isodow from v_first)::integer;
  if v_open is null then perform app.refuse('outside_hours'); end if;
  v_min := extract(hour from v_sorted[1] at time zone 'Asia/Bangkok')::integer * 60;
  v_open_min := extract(hour from v_open)::integer * 60 + extract(minute from v_open)::integer;
  v_close_min := case when v_close = time '24:00' then 1440
                      else extract(hour from v_close)::integer * 60 + extract(minute from v_close)::integer end;
  if v_min < v_open_min or v_min + 60 * v_n > v_close_min then
    perform app.refuse('outside_hours');
  end if;

  -- 5. Window by Bangkok date, day N inclusive (BOOK-01-AC4, AC12, D42). No setting, no booking.
  v_window := app.club_setting_text('booking_window_days')::integer;
  if v_window is null or v_first - v_today > v_window then perform app.refuse('outside_window'); end if;

  -- 6. Past and started hours (BOOK-01-AC5, D39).
  foreach s in array v_sorted loop
    if s + interval '1 hour' <= v_now then perform app.refuse('in_the_past'); end if;
    if not v_staff and s <= v_now then perform app.refuse('hour_started'); end if;
  end loop;

  -- 7. The court belongs to the club and is active (BOOK-01-AC9).
  if not exists (select 1 from public.resource where club_id = v_club and id = p_resource and active) then
    perform app.refuse('resource_inactive');
  end if;

  -- 9. A coach needs F07's rules; until they are installed a coach is never held (A-8).
  if p_coach is not null then perform app.refuse('coach_rules_not_installed'); end if;

  return jsonb_build_object('customer_id', v_ord.customer_id, 'source', v_ord.source, 'staff', v_staff);
end $$;
alter function app.reserve_court_check(uuid, uuid, timestamptz[], uuid, text) owner to booq_owner;
revoke all on function app.reserve_court_check(uuid, uuid, timestamptz[], uuid, text) from public;
grant execute on function app.reserve_court_check(uuid, uuid, timestamptz[], uuid, text) to booq_app, booq_worker;
