-- F03-T31 / migration 0227: move_booking calls the move handler of the coach rules. F03 design 4.3 and 4.7;
-- F07 design 5.1 and assumption A-3. Requirements: COACH-01-AC11, R3 (F07), BOOK-04-AC7, BOOK-06.
--
-- The coach rules hook of 0213 takes (club, coach, resource, starts[]) and has no booking id, so a moved
-- booking would count its own row against the rest rule. F07's 0803 registers a second handler,
-- app.coach_rules_check_move(club, coach, resource, starts[], booking), with app.register_coach_rules_move
-- (one row, like app.coach_rules_hook). move_booking calls it when it is registered and the four argument
-- hook otherwise, so with F07 not installed a move behaves exactly as in 0225 (no hook at all: a solo class
-- is refused with coach_rules_not_installed). Only the database owner registers a handler (migrations).

create table app.coach_rules_move_hook (
  only_row boolean primary key default true check (only_row),
  handler regproc not null
);
alter table app.coach_rules_move_hook owner to booq_owner;
revoke all on app.coach_rules_move_hook from public;

create function app.register_coach_rules_move(p_handler regproc) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ insert into app.coach_rules_move_hook (handler) values (p_handler)
      on conflict (only_row) do update set handler = excluded.handler $$;
alter function app.register_coach_rules_move(regproc) owner to booq_owner;
revoke all on function app.register_coach_rules_move(regproc) from public;

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
  v_move_rules regproc;
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
    select handler into v_move_rules from app.coach_rules_move_hook;
    if v_rules is null and v_move_rules is null then perform app.refuse('coach_rules_not_installed'); end if;
    perform app.lock_coach(v_coach);
  end if;
  select * into v_b from public.booking where club_id = v_club and id = p_booking for update;
  if v_b.status not in ('awaiting_payment', 'confirmed') or v_b.type = 'class_seat' then
    perform app.refuse('not_movable');
  end if;
  if v_b.resource_id = p_resource and v_b.start_at = p_start then return false; end if;

  if v_coach is not null and v_move_rules is not null then
    execute format('select %s($1, $2, $3, $4, $5)', v_move_rules) using v_club, v_coach, p_resource, array[p_start], p_booking;
  elsif v_coach is not null then
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
