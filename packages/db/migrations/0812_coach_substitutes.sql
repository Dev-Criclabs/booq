-- F07-T12 / migration 0812: the coaches who can take over a booked solo class (R4-AC6; F07 design 5.7).
-- app.substitutes_for_booking(booking) returns the active coaches other than the booking's coach for whom coach_check is null on the
-- booking's hour, with the booking's own occupancy row ignored (the court is already theirs, so court_hour_open of app.coaches_offerable
-- would count it as taken). The owner only. Advisory like every offer list: app.substitute_coach checks again under the locks.
create function app.substitutes_for_booking(p_booking uuid) returns setof uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  c record;
begin
  if not app.coach_caller_ok(null, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  select * into b from public.booking where club_id = v_club and id = p_booking
     and type = 'solo_class' and status = 'confirmed' and start_at > app.now();
  if b.id is null then
    perform app.refuse('booking_not_found');
  end if;
  for c in select co.id from public.coach co where co.club_id = v_club and co.active and co.id <> b.coach_id order by co.id loop
    if app.coach_check(v_club, c.id, array[b.start_at], p_booking) is null then
      return next c.id;
    end if;
  end loop;
end $$;
alter function app.substitutes_for_booking(uuid) owner to booq_owner;
revoke all on function app.substitutes_for_booking(uuid) from public;
grant execute on function app.substitutes_for_booking(uuid) to booq_app;
