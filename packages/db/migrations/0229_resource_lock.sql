-- Deadlock fix / migration 0229: a per-court lock taken last, immediately before every occupancy write.
-- Requirements: BOOK-04-AC1, AC12 (one success under parallel claims, never an error); FA 3.4; D159.
--
-- Cause (found with packages/db/src/reserve-court-stress.test.ts, no deadlock retries): two claims of the same
-- court and hour each inserted their occupancy row and then checked the exclusion constraint; each found the
-- other's uncommitted row and waited for that transaction, so each waited for the other (40P01 "while checking
-- exclusion constraint on tuple ... in relation occupancy"). Nothing serialised claims by different players for
-- one court: the customer lock is per player and the coach lock only applies to a solo class. withClubTx retries
-- a deadlock three times, and under 20-way load one request could lose four times in a row.
--
-- Fix: app.lock_resource(resource), a transaction advisory lock per club and court. Every function that writes
-- court occupancy takes it immediately before the write: reserve_court, move_booking (the target court),
-- confirm_booking and reclaim_order (the order's courts, ascending id). Two writers of one court now queue,
-- and the second sees the first's committed row (slot_unavailable) instead of a half-written one.
--
-- The lock order (FA 3.4, with this step added; every function below follows it):
--   0. the customer's advisory lock (app.lock_customer, the future-hours check)
--   1. coach rows, FOR UPDATE (app.lock_coach), ascending id
--   2. wallet_account and customer_package rows, ascending id; 2b. the promo_code row
--   3. booking and class_session rows, ascending id
--   3c. NEW: court advisory locks (app.lock_resource), ascending id, taken immediately before the occupancy write;
--       a transaction holding one takes no further lock except the receipt counter
--   4. receipt_counter, last
-- The court lock is the last lock on purpose. Taken earlier, reserve_court would hold it while its lazy release
-- of someone's expired hold runs the release handlers (credit and wallet rows of that player), and a Pay request
-- holding those rows and waiting for the court would close a cycle. reclaim_order now also takes the order's
-- coach rows (step 1) before its bookings: it inserts solo class rows, whose foreign key to the coach would
-- otherwise wait for a claim that holds the coach and is waiting for the court.
-- Later writers of occupancy (F07 add coach, F08 sessions, F09 closures) take app.lock_resource the same way.
-- Numbered above 0228, the last definition of reserve_court (and above 0227, 0218, 0217) under D159.

create function app.lock_resource(p_resource uuid) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ select pg_advisory_xact_lock(hashtextextended('resource:' || app.club_id()::text || ':' || p_resource::text, 0)) $$;
alter function app.lock_resource(uuid) owner to booq_owner;
revoke all on function app.lock_resource(uuid) from public;

create or replace function app.reserve_court(
  p_order uuid, p_resource uuid, p_starts timestamptz[], p_coach uuid default null, p_override_reason text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_now timestamptz := app.now();
  v_info jsonb;
  v_minutes integer;
  v_expires timestamptz;
  v_sorted timestamptz[];
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_constraint text;
  v_rules regproc;
  v_limit integer;
  v_customer uuid;
  v_override text;
  v_existing uuid;
  v_tap_count integer;
  v_tap_window integer;
  v_taps integer;
  v_oldest timestamptz;
  v_pay boolean;
  s timestamptz;
begin
  -- 1 to 7: everything that can be decided without claiming (typed refusals).
  v_info := app.reserve_court_check(p_order, p_resource, p_starts, null, p_override_reason);

  -- 2. A payment hold needs the hold setting; with none there is no default (BOOK-03-AC3). An order
  --    with nothing to pay (PAY-07, staff cash) takes no hold and does not need it (BOOK-03-AC9).
  v_pay := app.order_needs_payment(p_order);
  if v_pay then
    v_minutes := app.hold_minutes();
    if v_minutes is null then perform app.refuse('hold_setting_unset'); end if;
    v_expires := v_now + make_interval(mins => v_minutes);   -- one instant for the whole order (D46)
  else
    v_expires := null;
  end if;

  select array_agg(x order by x) into v_sorted from unnest(p_starts) x;

  -- The customer's lock comes first in the lock order (FA 3.4 step 0). Then the second tap (D47).
  v_override := null;
  v_customer := (v_info ->> 'customer_id')::uuid;
  if v_customer is not null then
    perform app.lock_customer(v_customer);
    select b.order_id into v_existing
      from public.booking b
     where b.club_id = v_club and b.customer_id = v_customer and b.created_by = v_user
       and b.status = 'awaiting_payment' and b.hold_expires_at > v_now
       and b.resource_id = p_resource and b.coach_id is not distinct from p_coach
     group by b.order_id
    having array_agg(b.start_at order by b.start_at) = v_sorted
     limit 1;
    if v_existing is not null then
      return (select jsonb_build_object('order_id', v_existing, 'booking_ids', jsonb_agg(id order by start_at),
                                        'hold_expires_at', min(hold_expires_at), 'reused', true)
                from public.booking where club_id = v_club and order_id = v_existing);
    end if;
  end if;

  -- 8. The future hours limit (BOOK-05).
  -- Step 1b, the limit on repeated Pay taps (D61). After the second tap lookup above, so a second tap that
  -- returns the existing hold is never an attempt and never refused (D47). The caller's own attempts count:
  -- a staff booking for a customer counts against the staff member.
  if v_user is not null then
    select app.pay_tap_limit_count(), app.pay_tap_limit_window_seconds() into v_tap_count, v_tap_window;
    if v_tap_count is not null and v_tap_window is not null then
      select count(*), min(at) into v_taps, v_oldest
        from public.pay_tap
       where club_id = v_club and user_id = v_user and at > v_now - make_interval(secs => v_tap_window);
      if v_taps >= v_tap_count then
        raise exception 'too_many_attempts' using errcode = 'BK001',
          detail = greatest(1, ceil(extract(epoch from (v_oldest + make_interval(secs => v_tap_window) - v_now))))::integer::text;
      end if;
    end if;
    insert into public.pay_tap (club_id, user_id, at) values (v_club, v_user, v_now);   -- rolled back with a refusal below
  end if;

  v_limit := app.max_future_court_hours();
  if v_limit is not null and v_customer is not null then
    if app.future_hours(v_customer) + cardinality(v_sorted) > v_limit then
      if not (v_info ->> 'staff')::boolean or coalesce(btrim(p_override_reason), '') = '' then
        raise exception 'limit_reached' using errcode = 'BK001', detail = v_limit::text;
      end if;
      v_override := btrim(p_override_reason);   -- staff over the limit: the reason is kept and audited
    end if;
  end if;

  -- 9. A coach: the rules must be installed; lock the coach, then ask them (FA 3.4 step 1).
  if p_coach is not null then
    select handler into v_rules from app.coach_rules_hook;
    if v_rules is null then perform app.refuse('coach_rules_not_installed'); end if;
    perform app.lock_coach(p_coach);
    execute format('select %s($1, $2, $3, $4)', v_rules) using v_club, p_coach, p_resource, v_sorted;
  end if;

  -- 10. Release expired holds in the way (FA 3.2), then claim every hour or none.
  perform app.release_expired_overlapping(p_resource, p_coach, v_sorted[1], v_sorted[cardinality(v_sorted)] + interval '1 hour');

  perform app.lock_resource(p_resource);   -- last lock before the occupancy write (header)

  begin
    foreach s in array v_sorted loop
      insert into public.booking (
        club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source,
        created_by, hold_expires_at, override_reason, confirmed_at
      ) values (
        v_club, p_order, case when p_coach is null then 'court' else 'solo_class' end, p_resource, p_coach,
        s, s + interval '1 hour', (v_info ->> 'customer_id')::uuid, case when v_pay then 'awaiting_payment' else 'confirmed' end,
        v_info ->> 'source', v_user, v_expires, v_override,
        case when v_pay then null else v_now end
      ) returning id into v_id;
      insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id)
      values (
        v_club, case when p_coach is null then 'court_booking' else 'solo_class' end, p_resource, p_coach,
        s, s + interval '1 hour', case when v_pay then 'held' else 'confirmed' end, v_expires, v_id
      );
      v_ids := v_ids || v_id;
    end loop;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'slot_unavailable' using errcode = 'BK001',
      detail = case when v_constraint = 'occupancy_no_overlap_coach' then 'coach' else 'resource' end;
  end;

  return jsonb_build_object('order_id', p_order, 'booking_ids', to_jsonb(v_ids), 'hold_expires_at', v_expires);
end $$;
alter function app.reserve_court(uuid, uuid, timestamptz[], uuid, text) owner to booq_owner;
revoke all on function app.reserve_court(uuid, uuid, timestamptz[], uuid, text) from public;
grant execute on function app.reserve_court(uuid, uuid, timestamptz[], uuid, text) to booq_app, booq_worker;

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

  for h in select handler from app.move_handlers order by ord, name loop
    execute format('select %s($1, $2, $3, $4, $5)', h.handler) using p_booking, v_b.resource_id, v_b.start_at, p_resource, p_start;
  end loop;
  return true;
end $$;
alter function app.move_booking(uuid, uuid, timestamptz) owner to booq_owner;
revoke all on function app.move_booking(uuid, uuid, timestamptz) from public;
grant execute on function app.move_booking(uuid, uuid, timestamptz) to booq_app, booq_worker;

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
  return true;
end $$;
alter function app.reclaim_order(uuid) owner to booq_owner;
revoke all on function app.reclaim_order(uuid) from public;
grant execute on function app.reclaim_order(uuid) to booq_app, booq_worker;

