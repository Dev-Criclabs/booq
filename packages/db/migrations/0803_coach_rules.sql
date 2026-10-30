-- F07-T03 / migration 0803: the coach rules (COACH-01-AC1 to AC12, R3-AC1 to AC7, CC-4). F07 design 5.1.
-- app.coach_check decides whether a coach can take given hours: the coach exists in the club and is active; each hour is
-- covered by an availability rule and not by a closed rule; no approved leave covers it; no other booking holds the
-- coach; the rest rule. It returns null or the first refusal code (coach_unavailable, rest_rule). It is the early
-- answer; the exclusion constraints of 0203 stay the real guard against a double booking (BOOK-04).
-- app.coach_rest_run finds the longest run of back to back hours that contains a candidate hour, counting every
-- hour the coach is busy (solo class, group class, staff booking; confirmed, or held and not expired) so unpaid held
-- hours count. A free hour breaks the run. The cap is the club setting rest_cap_hours; an empty one falls back to the
-- PRD's 6 (R3-AC6, D156). No function here takes an override argument: no role can exceed the cap (AC12, R3-AC5).
-- app.coach_rules_check is the hook of 0213 (reserve_court); app.coach_rules_check_move is the hook of 0227
-- (move_booking: the moved booking's own row is ignored). app.lock_coach locks the coach row (lock order, FA 3.4).
-- Weekday numbering of coach_availability_rule.weekday: 0 is Sunday to 6 Saturday in Bangkok time (the numbering of
-- Postgres extract(dow) and of JavaScript getDay), unlike opening_hours (1 Monday to 7 Sunday).

create function app.rest_cap() returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select coalesce((select nullif(s.value #>> '{}', '')::integer from public.club_setting s
                    where s.club_id = app.club_id() and s.key = 'rest_cap_hours'), 6)
$$;

-- Busy hours of a coach as hour numbers (epoch / 3600), excluding the booking or session being changed.
create function app.coach_busy_hours(p_coach uuid, p_from timestamptz, p_to timestamptz, p_ignore_booking uuid, p_ignore_session uuid)
returns table (h bigint)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select (extract(epoch from o.start_at) / 3600)::bigint
    from public.occupancy o
   where o.club_id = app.club_id() and o.coach_id = p_coach
     and o.start_at >= p_from and o.start_at < p_to
     and (o.state = 'confirmed' or o.hold_expires_at > app.now())
     and (p_ignore_booking is null or o.booking_id is distinct from p_ignore_booking)
     and (p_ignore_session is null or o.class_session_id is distinct from p_ignore_session)
$$;

create function app.coach_rest_run(p_coach uuid, p_starts timestamptz[], p_ignore_booking uuid default null, p_ignore_session uuid default null)
returns integer
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_cap integer := app.rest_cap();
  v_cand bigint[];
  v_run integer;
begin
  select array_agg(distinct (extract(epoch from s) / 3600)::bigint) into v_cand from unnest(p_starts) s;
  if v_cand is null then return 0; end if;
  with hours as (
    select unnest(v_cand) as h
    union
    select b.h from app.coach_busy_hours(p_coach,
        to_timestamp((select min(x) - v_cap - 1 from unnest(v_cand) x) * 3600),
        to_timestamp((select max(x) + v_cap + 2 from unnest(v_cand) x) * 3600),
        p_ignore_booking, p_ignore_session) b
  ), runs as (
    select h, h - row_number() over (order by h) as grp from hours
  ), sized as (
    select grp, count(*) as n, bool_or(h = any (v_cand)) as has_candidate from runs group by grp
  )
  select coalesce(max(n) filter (where has_candidate), 0)::integer into v_run from sized;
  return v_run;
end $$;

create function app.coach_check(p_club uuid, p_coach uuid, p_starts timestamptz[], p_ignore_booking uuid default null, p_ignore_session uuid default null)
returns text
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s timestamptz;
  v_date date;
  v_hour integer;
  v_dow integer;
begin
  if v_club is null or p_club is distinct from v_club then
    return 'coach_unavailable';                         -- another club's coach, or no club in the context (CC-1)
  end if;
  -- 1. The coach exists in the club and is active.
  if not exists (select 1 from public.coach c where c.club_id = v_club and c.id = p_coach and c.active) then
    return 'coach_unavailable';
  end if;
  foreach s in array p_starts loop
    v_date := (s at time zone 'Asia/Bangkok')::date;
    v_hour := extract(hour from s at time zone 'Asia/Bangkok')::integer;
    v_dow := extract(dow from s at time zone 'Asia/Bangkok')::integer;
    -- 2. Working: a weekly or open rule covers the hour and no closed rule does (a closed time wins).
    if not exists (
         select 1 from public.coach_availability_rule r
          where r.club_id = v_club and r.coach_id = p_coach and r.kind in ('weekly', 'open')
            and ((r.kind = 'weekly' and r.weekday = v_dow) or (r.kind = 'open' and r.on_date = v_date))
            and extract(hour from r.start_time) <= v_hour and v_hour + 1 <= extract(hour from r.end_time))
       or exists (
         select 1 from public.coach_availability_rule r
          where r.club_id = v_club and r.coach_id = p_coach and r.kind = 'closed' and r.on_date = v_date
            and extract(hour from r.start_time) <= v_hour and v_hour + 1 <= extract(hour from r.end_time)) then
      return 'coach_unavailable';
    end if;
    -- 3. No approved leave covers the hour (full days, or one date and whole hours).
    if exists (
         select 1 from public.coach_leave l
          where l.club_id = v_club and l.coach_id = p_coach and l.status = 'approved'
            and v_date between l.start_date and l.end_date
            and (l.from_hour is null or (v_hour >= l.from_hour and v_hour + 1 <= l.to_hour))) then
      return 'coach_unavailable';
    end if;
    -- 4. Not busy: no other occupancy of this coach overlaps the hour.
    if exists (
         select 1 from public.occupancy o
          where o.club_id = v_club and o.coach_id = p_coach and o.start_at < s + interval '1 hour' and o.end_at > s
            and (o.state = 'confirmed' or o.hold_expires_at > app.now())
            and (p_ignore_booking is null or o.booking_id is distinct from p_ignore_booking)
            and (p_ignore_session is null or o.class_session_id is distinct from p_ignore_session)) then
      return 'coach_unavailable';
    end if;
  end loop;
  -- 5. The rest rule.
  if app.coach_rest_run(p_coach, p_starts, p_ignore_booking, p_ignore_session) > app.rest_cap() then
    return 'rest_rule';
  end if;
  return null;
end $$;

-- A refusal the way F03 reports one: BK001 with the code as the message; rest_rule carries the cap as the detail.
create function app.coach_refuse(p_code text) returns void
language plpgsql set search_path = pg_catalog, pg_temp
as $$
begin
  if p_code = 'rest_rule' then
    raise exception 'rest_rule' using errcode = 'BK001', detail = app.rest_cap()::text;
  end if;
  raise exception '%', p_code using errcode = 'BK001';
end $$;

create function app.coach_rules_check(p_club uuid, p_coach uuid, p_resource uuid, p_starts timestamptz[]) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_code text;
begin
  v_code := app.coach_check(p_club, p_coach, p_starts, null, null);
  if v_code is not null then perform app.coach_refuse(v_code); end if;
end $$;

create function app.coach_rules_check_move(p_club uuid, p_coach uuid, p_resource uuid, p_starts timestamptz[], p_booking uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_code text;
begin
  v_code := app.coach_check(p_club, p_coach, p_starts, p_booking, null);
  if v_code is not null then perform app.coach_refuse(v_code); end if;
end $$;

-- 0213 left a placeholder advisory lock; the coach row is locked now (lock order step 1, FA 3.4). Defined in 0213,
-- redefined here with a higher number (D159). Runs as the function owner, which the coach table's definer policy allows.
create or replace function app.lock_coach(p_coach uuid) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$ select 1 from public.coach where club_id = app.club_id() and id = p_coach for update $$;

do $$
declare f text;
begin
  foreach f in array array['app.rest_cap()', 'app.coach_busy_hours(uuid, timestamptz, timestamptz, uuid, uuid)',
                           'app.coach_rest_run(uuid, timestamptz[], uuid, uuid)', 'app.coach_check(uuid, uuid, timestamptz[], uuid, uuid)',
                           'app.coach_refuse(text)', 'app.coach_rules_check(uuid, uuid, uuid, timestamptz[])',
                           'app.coach_rules_check_move(uuid, uuid, uuid, timestamptz[], uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

select app.register_coach_rules('app.coach_rules_check'::regproc);
select app.register_coach_rules_move('app.coach_rules_check_move'::regproc);
