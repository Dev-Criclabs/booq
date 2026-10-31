-- F09-T08a / migration 1009: app.closure_preview, app.create_closure. F09 design 4.6, 4.7.
-- Requirements: CANCEL-03-AC1 to AC8, AC13 to AC17; CC-4; QA CONC-13; decisions D48, D60, D85, D118.
--
--   * Occurrences (app.closure_occurrences): no repeat rule is the range itself. A daily or weekly rule (1002's shape) is
--     the range moved by whole Bangkok days, on every day (daily) or on the named ISO weekdays (weekly) from the range's
--     first day, up to today plus booking_window_days (F01) and never after "until"; the rest come as the window reaches
--     them (F09-T08b, T10). A repeat needs booking_window_days (closure:window_unset: a TBD setting has no default) and a
--     range of at most one day, so its occurrences never overlap one another. A weekly first day that is not a named
--     weekday is not an occurrence.
--   * What a closure touches: the parts of its occurrences after now on the named courts. A confirmed court booking or
--     solo class there that has not started is cancelled; an awaiting payment hold there is released; a group class
--     session there that has not started is cancelled for everyone. A booking or session that has started, or has been
--     played (AC8), is never touched: the closed slot is cut around it. So is another closure already on the court.
--   * app.closure_preview (AC1): read only, front desk and owner. The occurrences, the bookings and holds with the
--     players' names (staff only, CC-3), the sessions and their players, the expired packages whose credit was reserved
--     for an affected booking (AC12, D85: listed so the owner can extend them), the played and started bookings left
--     alone (AC8), and cancelCount, the number of bookings the closure would end at once.
--   * app.create_closure (AC2 to AC7, AC13 to AC17): front desk and owner, a written reason, one transaction for the
--     whole closure (AC15). No club status check: a Paused club closes as a Live one (AC13, D60), like cancel_booking.
--       1. the closure row and its courts (cancel_booking's closure foreign key needs them; audited, AC14);
--       2. locks in FA 3.4 order: the customers of every affected booking, hold and seat ascending (step 0), the
--          coaches of solo classes and sessions ascending (step 1), the affected booking rows ascending (step 3);
--       3. each confirmed booking: app.cancel_booking(booking, true, true, reason, closure) (kind closure, full value
--          whatever the time, AC2, AC7, AC12); each hold: app.release_hold(order, 'closed') (D48: no released message,
--          a Beam payment that comes later goes to the wallet, PAY-03, AC5); each session:
--          app.cancel_session(session, 'owner') (F08 has no closure reason; AC6: everyone's credit back, waitlist ended);
--       4. the court locks ascending (step 3c, last before the occupancy write). A booking or hold that another
--          transaction wrote into the range after step 2's read is now visible: the function stops with closure:busy
--          (SQLSTATE 40001), the whole transaction rolls back, and withClubTx runs it again, when the newcomer is in the
--          first read and is cancelled (AC3, AC16, CONC-13). A reserve that comes after the court lock waits for it and
--          then finds the closed slot (slot_unavailable). Exactly one outcome stands; withClubTx's three tries bound it;
--       5. the closure occupancy rows, one per court per occurrence part, after the cancels of step 3.
--     p_limit is the platform limit on bookings ended at once (assumption A-7; the number is platform config, read by the
--     route, null when unset): above it, closure:too_many and nothing is written. Messages are F09-T11's.
-- Refusals: closure:<code> with SQLSTATE P0001 (forbidden, invalid_court, invalid_range, invalid_repeat, window_unset,
-- ended, reason_required, too_many), closure:busy with 40001.

-- The occurrences of a range and repeat rule that the booking window reaches today, in start order.
create function app.closure_occurrences(p_start timestamptz, p_end timestamptz, p_rule jsonb)
returns table (occ_start timestamptz, occ_end timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_window text;
  v_first date := (p_start at time zone 'Asia/Bangkok')::date;
  v_last date;
begin
  if p_rule is null then
    return query select p_start, p_end;
    return;
  end if;
  v_window := app.club_setting_text('booking_window_days');
  if v_window is null or v_window !~ '^\d+$' then
    raise exception 'closure:window_unset' using errcode = 'P0001';
  end if;
  v_last := (app.now() at time zone 'Asia/Bangkok')::date + v_window::integer;
  if p_rule ? 'until' then
    v_last := least(v_last, (p_rule ->> 'until')::date);
  end if;
  return query
    select p_start + (x.d - v_first) * interval '1 day', p_end + (x.d - v_first) * interval '1 day'
      from generate_series(v_first::timestamp, v_last::timestamp, interval '1 day') g(day)
      cross join lateral (select g.day::date as d) x
     where p_rule ->> 'kind' = 'daily'
        or extract(isodow from x.d)::int in (select (w #>> '{}')::int from jsonb_array_elements(p_rule -> 'weekdays') w)
     order by 1;
end $$;
alter function app.closure_occurrences(timestamptz, timestamptz, jsonb) owner to booq_owner;
revoke all on function app.closure_occurrences(timestamptz, timestamptz, jsonb) from public;

-- The checks preview and create share; returns the parts of the occurrences after now, as one multirange.
create function app.closure_span(p_resources uuid[], p_start timestamptz, p_end timestamptz, p_rule jsonb)
returns tstzmultirange
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_span tstzmultirange;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'closure:forbidden' using errcode = 'P0001';
  end if;
  if p_resources is null or cardinality(p_resources) = 0 or array_position(p_resources, null) is not null
     or (select count(*) from public.resource r where r.club_id = v_club and r.id = any (p_resources))
        <> (select count(distinct x) from unnest(p_resources) x) then
    raise exception 'closure:invalid_court' using errcode = 'P0001';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'closure:invalid_range' using errcode = 'P0001';
  end if;
  if not app.valid_closure_repeat(p_rule)
     or (p_rule is not null and (p_end - p_start > interval '1 day'
         or (p_rule ? 'until' and (p_rule ->> 'until')::date < (p_start at time zone 'Asia/Bangkok')::date))) then
    raise exception 'closure:invalid_repeat' using errcode = 'P0001';
  end if;
  if (p_rule is null and p_end <= v_now)
     or (p_rule ? 'until' and (p_rule ->> 'until')::date < (v_now at time zone 'Asia/Bangkok')::date) then
    raise exception 'closure:ended' using errcode = 'P0001';
  end if;
  select coalesce(range_agg(tstzrange(greatest(o.occ_start, v_now), o.occ_end, '[)')), '{}'::tstzmultirange)
    into v_span
    from app.closure_occurrences(p_start, p_end, p_rule) o
   where o.occ_end > v_now;
  return v_span;
end $$;
alter function app.closure_span(uuid[], timestamptz, timestamptz, jsonb) owner to booq_owner;
revoke all on function app.closure_span(uuid[], timestamptz, timestamptz, jsonb) from public;

create function app.closure_person_name(p_user uuid) returns text
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select coalesce(nullif(btrim(u.display_name), ''), u.full_name)
    from public.app_user u where u.club_id = app.club_id() and u.id = p_user
$$;
alter function app.closure_person_name(uuid) owner to booq_owner;
revoke all on function app.closure_person_name(uuid) from public;

-- The expired packages that hold a reserved credit for one of these bookings (AC12, D85).
create function app.closure_expired_packages(p_bookings uuid[]) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('packageId', p.id, 'customerId', p.customer_id,
                                               'customerName', app.closure_person_name(p.customer_id), 'expiresAt', p.expires_at)
                            order by p.expires_at, p.id), '[]'::jsonb)
    from public.customer_package p
   where p.club_id = app.club_id() and p.expires_at <= app.now()
     and exists (select 1 from public.credit_ledger l
                  where l.club_id = p.club_id and l.package_id = p.id and l.reason = 'reserve' and l.booking_id = any (p_bookings))
$$;
alter function app.closure_expired_packages(uuid[]) owner to booq_owner;
revoke all on function app.closure_expired_packages(uuid[]) from public;

create function app.closure_preview(p_resources uuid[], p_start timestamptz, p_end timestamptz, p_rule jsonb default null)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_span tstzmultirange := app.closure_span(p_resources, p_start, p_end, p_rule);
  v_all tstzmultirange;
  v_bookings jsonb;
  v_sessions jsonb;
  v_ids uuid[];
  v_seats integer;
  v_played integer;
  v_started integer;
begin
  select coalesce(range_agg(tstzrange(o.occ_start, o.occ_end, '[)')), '{}'::tstzmultirange) into v_all
    from app.closure_occurrences(p_start, p_end, p_rule) o;

  select coalesce(jsonb_agg(jsonb_build_object('bookingId', b.id, 'status', b.status, 'type', b.type, 'resourceId', b.resource_id,
                                               'startAt', b.start_at, 'customerId', b.customer_id,
                                               'customerName', app.closure_person_name(b.customer_id), 'coachId', b.coach_id)
                            order by b.start_at, b.resource_id, b.id), '[]'::jsonb),
         coalesce(array_agg(b.id) filter (where b.status = 'confirmed'), '{}')
    into v_bookings, v_ids
    from public.booking b
   where b.club_id = v_club and b.type in ('court', 'solo_class') and b.resource_id = any (p_resources)
     and ((b.status = 'confirmed' and b.start_at > v_now) or b.status = 'awaiting_payment')
     and tstzrange(b.start_at, b.end_at, '[)') && v_span;

  select coalesce(jsonb_agg(jsonb_build_object('sessionId', s.id, 'resourceId', s.resource_id, 'startAt', s.start_at, 'coachId', s.coach_id,
                                               'players', (select coalesce(jsonb_agg(jsonb_build_object('bookingId', sb.id, 'status', sb.status,
                                                                     'customerId', sb.customer_id, 'customerName', app.closure_person_name(sb.customer_id))
                                                                     order by sb.id), '[]'::jsonb)
                                                             from public.booking sb
                                                            where sb.club_id = v_club and sb.class_session_id = s.id
                                                              and sb.status in ('awaiting_payment', 'confirmed')))
                            order by s.start_at, s.resource_id, s.id), '[]'::jsonb)
    into v_sessions
    from public.class_session s
   where s.club_id = v_club and s.resource_id = any (p_resources) and s.status <> 'cancelled' and s.start_at > v_now
     and tstzrange(s.start_at, s.end_at, '[)') && v_span;

  select count(*) into v_seats
    from public.booking sb join public.class_session s on s.club_id = sb.club_id and s.id = sb.class_session_id
   where sb.club_id = v_club and sb.status in ('awaiting_payment', 'confirmed')
     and s.resource_id = any (p_resources) and s.status <> 'cancelled' and s.start_at > v_now
     and tstzrange(s.start_at, s.end_at, '[)') && v_span;
  select coalesce(array_agg(sb.id), '{}') || v_ids into v_ids
    from public.booking sb join public.class_session s on s.club_id = sb.club_id and s.id = sb.class_session_id
   where sb.club_id = v_club and sb.status = 'confirmed'
     and s.resource_id = any (p_resources) and s.status <> 'cancelled' and s.start_at > v_now
     and tstzrange(s.start_at, s.end_at, '[)') && v_span;

  select count(*) filter (where b.end_at <= v_now), count(*) filter (where b.start_at <= v_now and b.end_at > v_now)
    into v_played, v_started
    from public.booking b
   where b.club_id = v_club and b.type in ('court', 'solo_class') and b.resource_id = any (p_resources) and b.status = 'confirmed'
     and tstzrange(b.start_at, b.end_at, '[)') && v_all;

  return jsonb_build_object(
    'occurrences', (select coalesce(jsonb_agg(jsonb_build_object('start', o.occ_start, 'end', o.occ_end) order by o.occ_start), '[]'::jsonb)
                      from app.closure_occurrences(p_start, p_end, p_rule) o),
    'bookings', v_bookings,
    'sessions', v_sessions,
    'expiredPackages', app.closure_expired_packages(v_ids),
    'playedCount', v_played,
    'startedCount', v_started,
    'cancelCount', jsonb_array_length(v_bookings) + v_seats);
end $$;
alter function app.closure_preview(uuid[], timestamptz, timestamptz, jsonb) owner to booq_owner;
revoke all on function app.closure_preview(uuid[], timestamptz, timestamptz, jsonb) from public;
grant execute on function app.closure_preview(uuid[], timestamptz, timestamptz, jsonb) to booq_app;

create function app.create_closure(
  p_resources uuid[], p_start timestamptz, p_end timestamptz, p_rule jsonb, p_reason text, p_limit integer default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_now timestamptz := app.now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_span tstzmultirange := app.closure_span(p_resources, p_start, p_end, p_rule);
  v_closure uuid;
  v_bookings uuid[];
  v_orders uuid[];
  v_sessions uuid[];
  v_count integer;
  v_cancelled uuid[] := '{}';
  v_released integer := 0;
  v_free tstzmultirange;
  v_rows integer := 0;
  v_id uuid;
  v_r jsonb;
  o record;
  r uuid;
  part tstzrange;
begin
  if v_reason is null then
    raise exception 'closure:reason_required' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', v_reason, true);

  -- What the closure touches, read before any lock.
  select coalesce(array_agg(b.id order by b.id) filter (where b.status = 'confirmed' and b.start_at > v_now), '{}'),
         coalesce(array_agg(distinct b.order_id) filter (where b.status = 'awaiting_payment'), '{}')
    into v_bookings, v_orders
    from public.booking b
   where b.club_id = v_club and b.type in ('court', 'solo_class') and b.resource_id = any (p_resources)
     and b.status in ('confirmed', 'awaiting_payment') and tstzrange(b.start_at, b.end_at, '[)') && v_span;
  select coalesce(array_agg(s.id order by s.id), '{}') into v_sessions
    from public.class_session s
   where s.club_id = v_club and s.resource_id = any (p_resources) and s.status <> 'cancelled' and s.start_at > v_now
     and tstzrange(s.start_at, s.end_at, '[)') && v_span;

  if p_limit is not null then
    select cardinality(v_bookings)
           + (select count(*) from public.booking b where b.club_id = v_club and b.order_id = any (v_orders) and b.status = 'awaiting_payment'
                and b.type in ('court', 'solo_class') and b.resource_id = any (p_resources) and tstzrange(b.start_at, b.end_at, '[)') && v_span)
           + (select count(*) from public.booking b where b.club_id = v_club and b.class_session_id = any (v_sessions) and b.status in ('awaiting_payment', 'confirmed'))
      into v_count;
    if v_count > p_limit then
      raise exception 'closure:too_many' using errcode = 'P0001', detail = v_count::text;
    end if;
  end if;

  -- 1. The definition, which the cancel records point at.
  insert into public.closure (club_id, reason, range_start, range_end, repeat_rule, created_by)
  values (v_club, v_reason, p_start, p_end, p_rule, v_user)
  returning id into v_closure;
  insert into public.closure_resource (club_id, closure_id, resource_id)
  select distinct v_club, v_closure, x from unnest(p_resources) x;

  -- 2. Locks in FA 3.4 order.
  perform app.lock_customer(c) from (
    select distinct customer_id as c from public.booking
     where club_id = v_club and customer_id is not null
       and (id = any (v_bookings) or order_id = any (v_orders) or (class_session_id = any (v_sessions) and status in ('awaiting_payment', 'confirmed')))
     union
    select customer_id from public.orders where club_id = v_club and id = any (v_orders) and customer_id is not null
     order by 1) x;
  perform app.lock_coach(c) from (
    select coach_id as c from public.booking where club_id = v_club and id = any (v_bookings) and coach_id is not null
     union
    select coach_id from public.class_session where club_id = v_club and id = any (v_sessions)
     order by 1) x;
  perform 1 from public.booking where club_id = v_club and id = any (v_bookings) order by id for update;

  -- 3. Cancel, release, cancel sessions.
  for v_id in select unnest(v_bookings) order by 1 loop
    v_r := app.cancel_booking(v_id, true, true, v_reason, v_closure);
    if not coalesce((v_r ->> 'repeated')::boolean, false) then
      v_cancelled := v_cancelled || v_id;
    end if;
  end loop;
  for v_id in select unnest(v_orders) order by 1 loop
    if app.release_hold(v_id, 'closed') then
      v_released := v_released + 1;
    end if;
  end loop;
  for v_id in select unnest(v_sessions) order by 1 loop
    perform app.cancel_session(v_id, 'owner');
  end loop;

  -- 4. The court locks, last; then nothing new may stand in the range.
  perform app.lock_resource(x) from (select distinct x from unnest(p_resources) x order by 1) y;
  if exists (select 1 from public.occupancy oc
              where oc.club_id = v_club and oc.resource_id = any (p_resources) and oc.kind <> 'closure' and oc.start_at > v_now
                and tstzrange(oc.start_at, oc.end_at, '[)') && v_span) then
    raise exception 'closure:busy' using errcode = '40001';
  end if;

  -- 5. The closed slots: each occurrence on each court, after now, around what has started and other closures.
  begin
    for o in select * from app.closure_occurrences(p_start, p_end, p_rule) where occ_end > v_now loop
      for r in select distinct x from unnest(p_resources) x order by 1 loop
        select tstzmultirange(tstzrange(greatest(o.occ_start, v_now), o.occ_end, '[)'))
               - coalesce(range_agg(tstzrange(oc.start_at, oc.end_at, '[)')), '{}'::tstzmultirange)
          into v_free
          from public.occupancy oc
         where oc.club_id = v_club and oc.resource_id = r
           and tstzrange(oc.start_at, oc.end_at, '[)') && tstzrange(greatest(o.occ_start, v_now), o.occ_end, '[)');
        for part in select unnest(v_free) loop
          insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id)
          values (v_club, 'closure', r, lower(part), upper(part), 'confirmed', v_closure);
          v_rows := v_rows + 1;
        end loop;
      end loop;
    end loop;
  exception when exclusion_violation then
    raise exception 'closure:busy' using errcode = '40001';
  end;

  return jsonb_build_object('closure', v_closure, 'cancelled', cardinality(v_cancelled), 'released', v_released,
                            'sessions', cardinality(v_sessions), 'slots', v_rows,
                            'expiredPackages', app.closure_expired_packages(v_cancelled));
end $$;
alter function app.create_closure(uuid[], timestamptz, timestamptz, jsonb, text, integer) owner to booq_owner;
revoke all on function app.create_closure(uuid[], timestamptz, timestamptz, jsonb, text, integer) from public;
grant execute on function app.create_closure(uuid[], timestamptz, timestamptz, jsonb, text, integer) to booq_app;
