-- migration 0230: F03's confirm, reclaim and move keep a booking's reminders in step. F10 design 5.4 (0607);
-- requirements LINE-05; decisions D96, D116, D159 (numbered above 0229, the last definition of all three).
--
--   * confirm_booking and reclaim_order call app.enqueue_booking_reminders(booking) for every booking they confirm,
--     in id order, after the occupancy rows are confirmed. The function queues the 24 hour and 2 hour reminders from
--     the message catalogue; a reminder whose hour has passed is dropped by enqueue_message, so a booking that starts
--     within two hours gets none. reclaim_order is included because a late payment confirms the bookings too.
--   * move_booking voids the booking's pending reminders (dedupe prefix reminder:{booking}:, reason moved) and queues
--     them again; the new start makes new keys. A booking that is not confirmed has none and gets none.
--   * The F09 cancel voids them with reason cancelled (F09-T06b). The functions are otherwise 0229's text.

create or replace function app.confirm_booking(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_ids uuid[];
begin
  if v_club is null
     or not (coalesce(current_setting('role', true), '') = 'booq_worker' or app.has_any_role('owner', 'front_desk')) then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;

  select array_agg(id order by id) into v_ids
    from (select id from public.booking
           where club_id = v_club and order_id = p_order and status = 'awaiting_payment'
           order by id for update) b;
  if v_ids is null then return false; end if;

  update public.booking
     set status = 'confirmed', hold_expires_at = null, confirmed_at = v_now, updated_at = v_now
   where club_id = v_club and id = any (v_ids) and status = 'awaiting_payment' and hold_expires_at > v_now;
  if not found then return false; end if;      -- the hold has ended: the job or the next claim releases it

  perform app.lock_resource(x.r) from (select distinct resource_id as r from public.booking
                                         where club_id = v_club and id = any (v_ids)) x order by x.r;
  update public.occupancy set state = 'confirmed', hold_expires_at = null
   where club_id = v_club and booking_id = any (v_ids) and state = 'held';
  perform app.enqueue_booking_reminders(x.id) from unnest(v_ids) x(id) order by x.id;   -- LINE-05 (0607)
  return true;
end $$;
alter function app.confirm_booking(uuid) owner to booq_owner;
revoke all on function app.confirm_booking(uuid) from public;
grant execute on function app.confirm_booking(uuid) to booq_app, booq_worker;

create or replace function app.reclaim_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_status text;
  v_ids uuid[];
  v_constraint text;
  b record;
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;

  -- The order's coaches first (lock order step 1), then its bookings (step 3).
  perform app.lock_coach(x.c) from (select distinct coach_id as c from public.booking
                                      where club_id = v_club and order_id = p_order and coach_id is not null) x order by x.c;
  select array_agg(id order by id) into v_ids
    from (select id from public.booking
           where club_id = v_club and order_id = p_order and status = 'released'
           order by id for update) x;
  if v_ids is null then return false; end if;

  select status into v_status from public.club where id = v_club;
  if v_status = 'paused' then perform app.refuse('club_paused'); end if;

  -- A hold of someone else that has ended must not block a player who has paid (FA 3.2).
  for b in select resource_id, coach_id, min(start_at) as s, max(end_at) as e
             from public.booking where club_id = v_club and id = any (v_ids) group by resource_id, coach_id loop
    perform app.release_expired_overlapping(b.resource_id, b.coach_id, b.s, b.e);
  end loop;

  perform app.lock_resource(x.r) from (select distinct resource_id as r from public.booking
                                         where club_id = v_club and id = any (v_ids)) x order by x.r;
  begin
    insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id)
    select club_id, case when coach_id is null then 'court_booking' else 'solo_class' end, resource_id, coach_id,
           start_at, end_at, 'confirmed', id
      from public.booking where club_id = v_club and id = any (v_ids) order by start_at;
    update public.booking
       set status = 'confirmed', confirmed_at = v_now, release_reason = null, released_at = null,
           hold_expires_at = null, updated_at = v_now
     where club_id = v_club and id = any (v_ids) and status = 'released';
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'slot_unavailable' using errcode = 'BK001',
      detail = case when v_constraint = 'occupancy_no_overlap_coach' then 'coach' else 'resource' end;
  end;
  perform app.enqueue_booking_reminders(x.id) from unnest(v_ids) x(id) order by x.id;   -- LINE-05 (0607)
  return true;
end $$;
alter function app.reclaim_order(uuid) owner to booq_owner;
revoke all on function app.reclaim_order(uuid) from public;
grant execute on function app.reclaim_order(uuid) to booq_app, booq_worker;

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

  perform app.lock_resource(p_resource);   -- last lock before the occupancy write (header)

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

  -- The booking's reminders follow it (F10 design 5.4): void the pending ones, queue them for the new start.
  perform app.void_messages('reminder:' || p_booking::text || ':', 'moved');
  perform app.enqueue_booking_reminders(p_booking);

  for h in select handler from app.move_handlers order by ord, name loop
    execute format('select %s($1, $2, $3, $4, $5)', h.handler) using p_booking, v_b.resource_id, v_b.start_at, p_resource, p_start;
  end loop;
  return true;
end $$;
alter function app.move_booking(uuid, uuid, timestamptz) owner to booq_owner;
revoke all on function app.move_booking(uuid, uuid, timestamptz) from public;
grant execute on function app.move_booking(uuid, uuid, timestamptz) to booq_app, booq_worker;

