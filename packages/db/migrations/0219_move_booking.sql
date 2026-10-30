-- F03-T15 / migration 0219: move_booking (staff). F03 design 4.3 and 4.7. Requirement: BOOK-04-AC7.
-- Decisions D60, D107; assumption A-5. Review SR-07.
--
-- Updates the booking and its occupancy row in place. The exclusion constraints re-check the move
-- (a taken slot or a busy coach is slot_unavailable and nothing changes), F07's coach rules run
-- for a solo class at the new time, and the move handlers are called once so the customer is told
-- (F10 registers the message, a new L key). Staff only: owner and front desk. A Paused club lets
-- only the owner manage existing bookings (D107, T22). Only the shape is checked (on the hour,
-- an active court): no window or past-hour rule is invented for a staff move.

create table app.move_handlers (
  name text primary key check (name <> ''),
  handler regproc not null,
  ord integer not null
);
alter table app.move_handlers owner to booq_owner;
revoke all on app.move_handlers from public;

-- A handler is (booking, from_resource, from_start, to_resource, to_start).
create function app.register_move_handler(p_name text, p_handler regproc, p_ord integer) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ insert into app.move_handlers (name, handler, ord) values (p_name, p_handler, p_ord) $$;
alter function app.register_move_handler(text, regproc, integer) owner to booq_owner;
revoke all on function app.register_move_handler(text, regproc, integer) from public;

create function app.move_booking(p_booking uuid, p_resource uuid, p_start timestamptz) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_status text;
  v_b public.booking%rowtype;
  v_coach uuid;
  v_rules regproc;
  v_constraint text;
  h record;
begin
  if v_club is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;
  select status into v_status from public.club where id = v_club;
  if v_status = 'paused' and not app.has_any_role('owner') then perform app.refuse('club_paused'); end if;
  if v_status is null or v_status not in ('draft', 'testing', 'live', 'paused') then perform app.refuse('club_not_available'); end if;

  if extract(minute from p_start at time zone 'Asia/Bangkok') <> 0
     or extract(second from p_start at time zone 'Asia/Bangkok') <> 0 then
    perform app.refuse('not_on_the_hour');
  end if;
  if not exists (select 1 from public.resource where club_id = v_club and id = p_resource and active) then
    perform app.refuse('resource_inactive');
  end if;

  -- Coach first in the lock order (FA 3.4 step 1), then the booking row (step 3).
  select coach_id into v_coach from public.booking where club_id = v_club and id = p_booking;
  if not found then perform app.refuse('booking_not_found'); end if;
  if v_coach is not null then
    select handler into v_rules from app.coach_rules_hook;
    if v_rules is null then perform app.refuse('coach_rules_not_installed'); end if;
    perform app.lock_coach(v_coach);
  end if;
  select * into v_b from public.booking where club_id = v_club and id = p_booking for update;
  if v_b.status not in ('awaiting_payment', 'confirmed') or v_b.type = 'class_seat' then
    perform app.refuse('not_movable');
  end if;
  if v_b.resource_id = p_resource and v_b.start_at = p_start then return false; end if;

  if v_coach is not null then
    execute format('select %s($1, $2, $3, $4)', v_rules) using v_club, v_coach, p_resource, array[p_start];
  end if;
  perform app.release_expired_overlapping(p_resource, v_coach, p_start, p_start + interval '1 hour');

  begin
    update public.occupancy set resource_id = p_resource, start_at = p_start, end_at = p_start + interval '1 hour'
     where club_id = v_club and booking_id = p_booking;
    update public.booking set resource_id = p_resource, start_at = p_start, end_at = p_start + interval '1 hour', updated_at = v_now
     where club_id = v_club and id = p_booking;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'slot_unavailable' using errcode = 'BK001',
      detail = case when v_constraint = 'occupancy_no_overlap_coach' then 'coach' else 'resource' end;
  end;

  for h in select handler from app.move_handlers order by ord, name loop
    execute format('select %s($1, $2, $3, $4, $5)', h.handler) using p_booking, v_b.resource_id, v_b.start_at, p_resource, p_start;
  end loop;
  return true;
end $$;
alter function app.move_booking(uuid, uuid, timestamptz) owner to booq_owner;
revoke all on function app.move_booking(uuid, uuid, timestamptz) from public;
grant execute on function app.move_booking(uuid, uuid, timestamptz) to booq_app, booq_worker;
