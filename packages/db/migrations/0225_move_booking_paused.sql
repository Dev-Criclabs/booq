-- F03-T22 / migration 0225: move_booking in a Paused club follows D107. Requirement: BOOK-04-AC7.
-- Decisions D60, D107. 0219 let only the owner move while Paused; D107 (the later decision) lets the owner
-- and front desk move, release, add a coach, cancel and mark no show on existing bookings while the club
-- is Paused. New holds stay refused for everyone (reserve_court, D60). The function is otherwise 0219's,
-- unchanged: staff only, shape checks, coach rules, constraints re-check the move, move handlers called.

create or replace function app.move_booking(p_booking uuid, p_resource uuid, p_start timestamptz) returns boolean
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
