-- F03-T16 / migration 0222: the guard behind the F01 routes PUT /hours and PUT /resources/{id}.
-- F03 design 4.7. Requirement: BOOK-01-AC16. Decision D50. Review SR-07 (the club is app.club_id()).
--
-- "Live" means a booking or hold that still matters: a court booking, solo class or group class
-- occupancy row whose hour has not ended and which is confirmed or held with the hold not ended.
-- A closure is not a booking and never blocks. The owner who needs to change hours over live
-- bookings uses a closure (F09) instead; the refusal code live_bookings_exist carries that hint
-- through its locale key. The F01 routes call the assert_ functions inside their own transaction.
-- Only owner and front desk may ask.

create function app.count_live_occupancy(p_resource uuid default null) returns integer
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;
  return (select count(*)::integer from public.occupancy
           where club_id = app.club_id() and kind in ('court_booking', 'solo_class', 'group_class')
             and end_at > app.now() and (state = 'confirmed' or hold_expires_at > app.now())
             and (p_resource is null or resource_id = p_resource));
end $$;
alter function app.count_live_occupancy(uuid) owner to booq_owner;
revoke all on function app.count_live_occupancy(uuid) from public;
grant execute on function app.count_live_occupancy(uuid) to booq_app, booq_worker;

-- Live hours on one ISO weekday (Bangkok) that would fall outside the new opening hours. A null
-- open and close mean the weekday is closed altogether. close may be 24:00.
create function app.count_live_occupancy_outside_hours(p_weekday integer, p_open time, p_close time) returns integer
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_open integer := case when p_open is null then null else extract(hour from p_open)::integer * 60 + extract(minute from p_open)::integer end;
  v_close integer := case when p_close is null then null
                          when p_close = time '24:00' then 1440
                          else extract(hour from p_close)::integer * 60 + extract(minute from p_close)::integer end;
begin
  if app.club_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;
  return (select count(*)::integer from public.occupancy o
           where o.club_id = app.club_id() and o.kind in ('court_booking', 'solo_class', 'group_class')
             and o.end_at > app.now() and (o.state = 'confirmed' or o.hold_expires_at > app.now())
             and extract(isodow from o.start_at at time zone 'Asia/Bangkok')::integer = p_weekday
             and (v_open is null or v_close is null
                  or (extract(hour from o.start_at at time zone 'Asia/Bangkok')::integer * 60) < v_open
                  or (extract(hour from o.start_at at time zone 'Asia/Bangkok')::integer * 60) + 60 > v_close));
end $$;
alter function app.count_live_occupancy_outside_hours(integer, time, time) owner to booq_owner;
revoke all on function app.count_live_occupancy_outside_hours(integer, time, time) from public;
grant execute on function app.count_live_occupancy_outside_hours(integer, time, time) to booq_app, booq_worker;

create function app.assert_hours_change_allowed(p_weekday integer, p_open time, p_close time) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.count_live_occupancy_outside_hours(p_weekday, p_open, p_close) > 0 then
    perform app.refuse('live_bookings_exist');
  end if;
end $$;
alter function app.assert_hours_change_allowed(integer, time, time) owner to booq_owner;
revoke all on function app.assert_hours_change_allowed(integer, time, time) from public;
grant execute on function app.assert_hours_change_allowed(integer, time, time) to booq_app, booq_worker;

-- Only taking a court out of service is guarded; activating or leaving it active always passes.
create function app.assert_resource_change_allowed(p_resource uuid, p_active boolean) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if not p_active and app.count_live_occupancy(p_resource) > 0 then
    perform app.refuse('live_bookings_exist');
  end if;
end $$;
alter function app.assert_resource_change_allowed(uuid, boolean) owner to booq_owner;
revoke all on function app.assert_resource_change_allowed(uuid, boolean) from public;
grant execute on function app.assert_resource_change_allowed(uuid, boolean) to booq_app, booq_worker;
