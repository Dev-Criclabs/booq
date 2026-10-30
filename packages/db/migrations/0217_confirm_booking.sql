-- F03-T13 / migration 0217: confirm_booking and the PAY-07 path. F03 design 4.3 and FA 3.4.
-- Requirements: BOOK-03-AC7, AC9, BOOK-04-AC8. Review SR-07 (D124).
--
-- app.confirm_booking(order) is the one place a hold becomes a booking: a guarded UPDATE ... WHERE
-- status = 'awaiting_payment' AND hold_expires_at > now() under the booking row locks (FA 3.4
-- step 3), so it and release_hold cannot both win. It returns false when there is nothing to
-- confirm (already confirmed or released, hold ended, other club's order): the payment path then
-- treats the payment as late (reclaim_order, F03-T14, F05).
-- It confirms only on the payment path: the worker role (the payment callback and lookup) or
-- staff (cash or a checked slip). A player cannot confirm their own order.
--
-- confirm_now is not a parameter of reserve_court (SR-07). Whether an order still needs payment is
-- decided by app.order_needs_payment(order), a seam F04 replaces with the frozen amount due being
-- more than zero and no cash payment record. Until F04 exists every order needs payment.

create function app.order_needs_payment(p_order uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select true $$;
alter function app.order_needs_payment(uuid) owner to booq_owner;
revoke all on function app.order_needs_payment(uuid) from public;

create function app.confirm_booking(p_order uuid) returns boolean
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

  update public.occupancy set state = 'confirmed', hold_expires_at = null
   where club_id = v_club and booking_id = any (v_ids) and state = 'held';
  return true;
end $$;
alter function app.confirm_booking(uuid) owner to booq_owner;
revoke all on function app.confirm_booking(uuid) from public;
grant execute on function app.confirm_booking(uuid) to booq_app, booq_worker;

-- reserve_court with the PAY-07 path: an order with nothing to pay is confirmed in the claim.
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
