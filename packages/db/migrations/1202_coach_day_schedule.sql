-- F12-T02 / migration 1202: the coach's day and week (K1, K2). F12 design 5.1 and 5.2. Requirements: CPORT-01, CPORT-02, COACH-01; CC-1, CC-2.
--   app.coach_day(date)            the signed-in coach's sessions on one Bangkok day, in time order
--   app.coach_schedule(from, to)   the same for a range of at most 14 days, plus the coach's own leave and the blocked times
-- The coach is the signed-in person and never an input. Solo classes are bookings of type solo_class held by the coach
-- (booking.coach_id, which a substitution moves); group sessions are class_session rows of the coach. Shown: confirmed, held
-- (awaiting payment, marked held) and no show solo classes; scheduled and needs_attention group sessions. Never shown: cancelled,
-- late cancelled and released bookings, cancelled sessions. The only facts about a player are the name the player gave and their
-- level; no phone, date of birth or payment. Blocked times (assumption A-5): the coach's own one off closed rules and the club's closed
-- court slots (the closure's reason as the owner typed it). Pending and approved leave show; declined leave does not.
-- Errors: portal:forbidden (not a coach of this club), portal:invalid_range.

create function app.portal_coach() returns uuid
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.user_id();
begin
  if app.club_id() is null or v_me is null or not app.has_any_role('coach')
     or not exists (select 1 from public.coach c where c.club_id = app.club_id() and c.id = v_me) then
    raise exception 'portal:forbidden' using errcode = 'P0001';
  end if;
  return v_me;
end $$;
alter function app.portal_coach() owner to booq_owner;
revoke all on function app.portal_coach() from public;

-- The sessions of one coach between two instants. Internal: no role is granted execute.
create function app.portal_sessions(p_coach uuid, p_from timestamptz, p_to timestamptz) returns table (
  kind text, ref_id uuid, start_at timestamptz, end_at timestamptz, court text, held boolean, student_name text,
  class_name_th text, class_name_en text, level text, players integer, capacity integer, needs_attention boolean, status text)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
begin
  return query
    select 'solo'::text, b.id, b.start_at, b.end_at, r.name, b.status = 'awaiting_payment', coalesce(u.full_name, u.display_name),
           null::text, null::text, u.level, 1, null::integer, false, b.status
      from public.booking b
      join public.resource r on r.club_id = b.club_id and r.id = b.resource_id
      join public.app_user u on u.club_id = b.club_id and u.id = b.customer_id
     where b.club_id = v_club and b.type = 'solo_class' and b.coach_id = p_coach
       and b.status in ('confirmed', 'awaiting_payment', 'no_show')
       and b.start_at >= p_from and b.start_at < p_to
    union all
    select 'group'::text, s.id, s.start_at, s.end_at, r.name, false, null::text,
           s.name_th, s.name_en, s.level,
           (select count(*)::integer from public.booking k where k.club_id = s.club_id and k.class_session_id = s.id and k.status = 'confirmed'),
           s.max_players::integer, s.status = 'needs_attention', s.status
      from public.class_session s
      join public.resource r on r.club_id = s.club_id and r.id = s.resource_id
     where s.club_id = v_club and s.coach_id = p_coach and s.status in ('scheduled', 'needs_attention')
       and s.start_at >= p_from and s.start_at < p_to
    order by 3, 2;
end $$;
alter function app.portal_sessions(uuid, timestamptz, timestamptz) owner to booq_owner;
revoke all on function app.portal_sessions(uuid, timestamptz, timestamptz) from public;

create function app.coach_day(p_date date) returns table (
  kind text, ref_id uuid, start_at timestamptz, end_at timestamptz, court text, held boolean, student_name text,
  class_name_th text, class_name_en text, level text, players integer, capacity integer, needs_attention boolean, status text)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
  v_day date := coalesce(p_date, (app.now() at time zone 'Asia/Bangkok')::date);
begin
  return query select * from app.portal_sessions(v_me, v_day::timestamp at time zone 'Asia/Bangkok', (v_day + 1)::timestamp at time zone 'Asia/Bangkok');
end $$;
alter function app.coach_day(date) owner to booq_owner;
revoke all on function app.coach_day(date) from public;

create function app.coach_schedule(p_from date, p_to date) returns table (
  item text, kind text, ref_id uuid, start_at timestamptz, end_at timestamptz, court text, held boolean, student_name text,
  class_name_th text, class_name_en text, level text, players integer, capacity integer, needs_attention boolean, status text, note text)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
  v_club uuid := app.club_id();
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 13 then
    raise exception 'portal:invalid_range' using errcode = 'P0001';
  end if;
  v_from := p_from::timestamp at time zone 'Asia/Bangkok';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
  return query
    select * from (
      select 'session'::text as item, x.kind, x.ref_id, x.start_at, x.end_at, x.court, x.held, x.student_name, x.class_name_th, x.class_name_en, x.level,
             x.players, x.capacity, x.needs_attention, x.status, null::text as note
        from app.portal_sessions(v_me, v_from, v_to) x
      union all
      select 'leave'::text, null::text, l.id,
             case when l.from_hour is null then l.start_date::timestamp at time zone 'Asia/Bangkok' else (l.start_date::timestamp + make_interval(hours => l.from_hour)) at time zone 'Asia/Bangkok' end,
             case when l.to_hour is null then (l.end_date + 1)::timestamp at time zone 'Asia/Bangkok' else (l.start_date::timestamp + make_interval(hours => l.to_hour)) at time zone 'Asia/Bangkok' end,
             null::text, false, null::text, null::text, null::text, null::text, null::integer, null::integer, false, l.status, l.type
        from public.coach_leave l
       where l.club_id = v_club and l.coach_id = v_me and l.status in ('pending', 'approved')
         and l.start_date <= p_to and l.end_date >= p_from
      union all
      select 'blocked'::text, null::text, k.id, (k.on_date + k.start_time) at time zone 'Asia/Bangkok', (k.on_date + k.end_time) at time zone 'Asia/Bangkok',
             null::text, false, null::text, null::text, null::text, null::text, null::integer, null::integer, false, 'closed'::text, null::text
        from public.coach_availability_rule k
       where k.club_id = v_club and k.coach_id = v_me and k.kind = 'closed' and k.on_date between p_from and p_to
      union all
      select 'blocked'::text, null::text, c.id, o.start_at, o.end_at, r.name, false, null::text, null::text, null::text, null::text, null::integer, null::integer, false, 'closed'::text, c.reason
        from public.occupancy o
        join public.closure c on c.club_id = o.club_id and c.id = o.closure_id
        join public.resource r on r.club_id = o.club_id and r.id = o.resource_id
       where o.club_id = v_club and o.kind = 'closure' and o.start_at < v_to and o.end_at > v_from
    ) z
    order by z.start_at, z.item, z.ref_id;
end $$;
alter function app.coach_schedule(date, date) owner to booq_owner;
revoke all on function app.coach_schedule(date, date) from public;

grant execute on function app.coach_day(date), app.coach_schedule(date, date) to booq_app;
