-- F08-T05a / migration 0905: who sees a class, whether a weekly class can be placed, and making its sessions
-- (CLASS-01-AC1 to AC3, AC5, AC9, AC12; D12, D62, D84). F08 design 4.2, 4.3, 4.6.
--   app.class_visible(session, customer)  true when the session's audience is the customer's price group (under 18 on the
--       Bangkok date is Student, else Adult; no date of birth is Adult, D12: the same rule as packages/domain price-group.ts),
--       or when the customer holds a group credit, with credits left and not expired, bought for that audience (a player now 18
--       who holds a Student credit still sees the Student classes it was bought for, D84). A null customer is a guest and sees
--       Adult. The date of birth is read inside and never returned. Every route that shows or takes a seat calls it (CC-2).
--   app.class_hour_problem(coach, court, start, template)  the first reason an hour cannot take the class: outside_hours,
--       court_clash, coach_clash (these refuse a template) or coach_leave, coach_rest (these flag the session, they do not
--       refuse). A court clash is any confirmed or unexpired held occupancy or closure on the court, a coach clash the same on
--       the coach, other than this template's own sessions. coach_leave covers a coach who is on approved leave, not working
--       that hour, or inactive; coach_rest is the rest rule, which counts group classes (CLASS-01-AC12).
--   app.check_template(coach, court, weekday, start_time, template)  the dry run over the booking window (booking_window_days
--       from today, day N included, D42): {clashes: [{date, reason}], attention: [{date, reason}]}. A template is saved only when
--       clashes is empty (typed template_clash with the dates, CLASS-01-AC3). template is the template being changed, so its own
--       sessions do not clash with it.
--   app.generate_sessions(from, to)  makes the sessions of every active template for the dates given (the window moves daily;
--       the unique key makes a rerun harmless). A session whose court and coach are free is scheduled and claims both in one
--       occupancy row of kind group_class; any other is needs_attention with its reason and no occupancy row, never skipped
--       silently (CLASS-01-AC3, AC9). Owner, front desk and the worker; returns how many sessions were made.
-- Court locks (app.lock_resource, FA 3.4 step 3c) are added to generate_sessions when 0229 reaches main.

create function app.price_audience(p_dob date, p_on date) returns text
language sql immutable set search_path = pg_catalog
as $$ select case when p_dob is null then 'adult' when date_part('year', age(p_on, p_dob)) < 18 then 'student' else 'adult' end $$;
alter function app.price_audience(date, date) owner to booq_owner;
revoke all on function app.price_audience(date, date) from public;

create function app.class_visible(p_session uuid, p_customer uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_audience text;
  v_dob date;
begin
  if v_club is null then
    return false;
  end if;
  select s.audience into v_audience from public.class_session s where s.club_id = v_club and s.id = p_session;
  if v_audience is null then
    return false;
  end if;
  if p_customer is null then
    return v_audience = 'adult';
  end if;
  select u.date_of_birth into v_dob from public.app_user u where u.club_id = v_club and u.id = p_customer and u.active;
  if not found then
    return false;
  end if;
  if app.price_audience(v_dob, (app.now() at time zone 'Asia/Bangkok')::date) = v_audience then
    return true;
  end if;
  return exists (
    select 1
      from public.package_status st
      join public.customer_package cp on cp.club_id = st.club_id and cp.id = st.package_id
      join public.package_product pp on pp.club_id = cp.club_id and pp.id = cp.product_id
      join public.price_group g on g.club_id = pp.club_id and g.id = pp.price_group_id
     where st.club_id = v_club and st.customer_id = p_customer and st.status = 'active'
       and pp.credit_type = 'group_session'
       and (case when g.rule ? 'max_age' and (g.rule ->> 'max_age')::int < 18 then 'student' else 'adult' end) = v_audience);
end $$;
alter function app.class_visible(uuid, uuid) owner to booq_owner;
revoke all on function app.class_visible(uuid, uuid) from public;
grant execute on function app.class_visible(uuid, uuid) to booq_app, booq_worker;

create function app.class_hour_problem(p_coach uuid, p_resource uuid, p_start timestamptz, p_template uuid default null) returns text
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_local timestamp := p_start at time zone 'Asia/Bangkok';
  v_secs integer := extract(epoch from v_local::time)::integer;
  v_code text;
begin
  if not exists (select 1 from public.resource r join public.opening_hours oh on oh.club_id = r.club_id and oh.weekday = extract(isodow from v_local)::int
                  where r.club_id = v_club and r.id = p_resource and r.active
                    and v_secs >= extract(epoch from oh.open) and v_secs + 3600 <= extract(epoch from oh.close)) then
    return 'outside_hours';
  end if;
  if exists (select 1 from public.occupancy o
              where o.club_id = v_club and o.resource_id = p_resource and o.start_at < p_start + interval '1 hour' and o.end_at > p_start
                and (o.state = 'confirmed' or o.hold_expires_at > app.now())
                and (p_template is null or o.class_session_id is null
                     or not exists (select 1 from public.class_session s where s.club_id = o.club_id and s.id = o.class_session_id and s.template_id = p_template))) then
    return 'court_clash';
  end if;
  if exists (select 1 from public.occupancy o
              where o.club_id = v_club and o.coach_id = p_coach and o.start_at < p_start + interval '1 hour' and o.end_at > p_start
                and (o.state = 'confirmed' or o.hold_expires_at > app.now())
                and (p_template is null or o.class_session_id is null
                     or not exists (select 1 from public.class_session s where s.club_id = o.club_id and s.id = o.class_session_id and s.template_id = p_template))) then
    return 'coach_clash';
  end if;
  -- The coach check also sees the busy rows of this template's own sessions: ignore them by session, one at a time.
  v_code := app.coach_check(v_club, p_coach, array[p_start], null, null);
  if v_code = 'coach_unavailable' and p_template is not null then
    -- Busy only because of this template's own session at this hour? Then it is not a problem; any other cause is coach_leave.
    if exists (select 1 from public.occupancy o join public.class_session s on s.club_id = o.club_id and s.id = o.class_session_id
                where o.club_id = v_club and o.coach_id = p_coach and s.template_id = p_template and o.start_at = p_start
                  and (o.state = 'confirmed' or o.hold_expires_at > app.now())) then
      v_code := app.coach_check(v_club, p_coach, array[p_start], null,
                                (select s.id from public.occupancy o join public.class_session s on s.club_id = o.club_id and s.id = o.class_session_id
                                  where o.club_id = v_club and o.coach_id = p_coach and s.template_id = p_template and o.start_at = p_start limit 1));
    end if;
  end if;
  if v_code = 'coach_unavailable' then return 'coach_leave'; end if;
  if v_code = 'rest_rule' then return 'coach_rest'; end if;
  return null;
end $$;
alter function app.class_hour_problem(uuid, uuid, timestamptz, uuid) owner to booq_owner;
revoke all on function app.class_hour_problem(uuid, uuid, timestamptz, uuid) from public;

-- The dates a weekly class falls on between two Bangkok dates, with their start instants.
create function app.class_dates(p_weekday smallint, p_start_time time, p_from date, p_to date) returns table (day date, start_at timestamptz)
language sql stable set search_path = pg_catalog
as $$
  select d::date, (d::date + p_start_time) at time zone 'Asia/Bangkok'
    from generate_series(p_from, p_to, interval '1 day') as d
   where extract(dow from d) = p_weekday
$$;
alter function app.class_dates(smallint, time, date, date) owner to booq_owner;
revoke all on function app.class_dates(smallint, time, date, date) from public;

create function app.check_template(p_coach uuid, p_resource uuid, p_weekday smallint, p_start_time time, p_template uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_window text := app.club_setting_text('booking_window_days');
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_clashes jsonb := '[]'::jsonb;
  v_attention jsonb := '[]'::jsonb;
  d record;
  v_problem text;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'template: not allowed' using errcode = '42501';
  end if;
  if v_window is null or v_window !~ '^[0-9]+$' then
    perform app.refuse('booking_window_unset');
  end if;
  for d in select * from app.class_dates(p_weekday, p_start_time, v_today, v_today + v_window::int) where start_at > app.now() order by start_at loop
    v_problem := app.class_hour_problem(p_coach, p_resource, d.start_at, p_template);
    if v_problem in ('outside_hours', 'court_clash', 'coach_clash') then
      v_clashes := v_clashes || jsonb_build_object('date', d.day, 'reason', v_problem);
    elsif v_problem is not null then
      v_attention := v_attention || jsonb_build_object('date', d.day, 'reason', v_problem);
    end if;
  end loop;
  return jsonb_build_object('clashes', v_clashes, 'attention', v_attention);
end $$;
alter function app.check_template(uuid, uuid, smallint, time, uuid) owner to booq_owner;
revoke all on function app.check_template(uuid, uuid, smallint, time, uuid) from public;
grant execute on function app.check_template(uuid, uuid, smallint, time, uuid) to booq_app;

create function app.generate_sessions(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_worker boolean := coalesce(current_setting('role', true), '') = 'booq_worker';
  t public.class_template%rowtype;
  d record;
  v_problem text;
  v_id uuid;
  v_n integer := 0;
begin
  if v_club is null or not (v_worker or app.has_any_role('owner', 'front_desk')) then
    raise exception 'template: not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'template: invalid range' using errcode = 'P0001';
  end if;
  for t in select * from public.class_template c where c.club_id = v_club and c.active order by c.id loop
    for d in select * from app.class_dates(t.weekday, t.start_time, p_from, p_to)
              where start_at > app.now() and (t.ended_on is null or day <= t.ended_on) order by start_at loop
      if exists (select 1 from public.class_session s where s.club_id = v_club and s.template_id = t.id and s.start_at = d.start_at) then
        continue;
      end if;
      -- Lock order: the coach, then the court (FA 3.4).
      perform app.lock_coach(t.coach_id);
      v_problem := app.class_hour_problem(t.coach_id, t.resource_id, d.start_at, null);
      insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, level, coach_id, resource_id,
                                        min_players, max_players, drop_in_price_satang, status, attention_reason)
      values (v_club, t.id, d.start_at, d.start_at + interval '1 hour', t.name_th, t.name_en, t.audience, t.level, t.coach_id, t.resource_id,
              t.min_players, t.max_players, t.drop_in_price_satang, case when v_problem is null then 'scheduled' else 'needs_attention' end, v_problem)
      returning id into v_id;
      if v_problem is null then
        begin
          insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id)
          values (v_club, 'group_class', t.resource_id, t.coach_id, d.start_at, d.start_at + interval '1 hour', 'confirmed', v_id);
        exception when exclusion_violation then
          -- A claim won the hour between the check and the insert: the session is flagged, not lost.
          update public.class_session set status = 'needs_attention',
                 attention_reason = case when exists (select 1 from public.occupancy o where o.club_id = v_club and o.resource_id = t.resource_id
                                                        and o.start_at < d.start_at + interval '1 hour' and o.end_at > d.start_at) then 'court_clash' else 'coach_clash' end
           where club_id = v_club and id = v_id;
        end;
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
alter function app.generate_sessions(date, date) owner to booq_owner;
revoke all on function app.generate_sessions(date, date) from public;
grant execute on function app.generate_sessions(date, date) to booq_app, booq_worker;
