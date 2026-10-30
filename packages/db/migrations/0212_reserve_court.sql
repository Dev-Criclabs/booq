-- F03-T08 / migration 0212: reserve_court, the claim. F03 design 4.2 step 10 and 4.3; FA 3.3.
-- Requirements: BOOK-04-AC1, AC4, AC5, AC12, BOOK-06, BOOK-03-AC1, AC3, AC6. SR-07, D40, D43, D46.
--
-- SECURITY DEFINER with a fixed search path. The club comes from app.club_id() only; the
-- customer is the order's customer, checked by app.reserve_court_check. This is the only write
-- path for booking and occupancy (the application roles hold no privilege on either).
--
-- It inserts one booking and one occupancy row per hour, in hour order, inside a sub-block, so
-- an exclusion violation on any hour undoes the hours already inserted (all or nothing) and is
-- reported as the typed code slot_unavailable with DETAIL 'resource' or 'coach' (BOOK-04-AC4).
-- This migration creates the payment-hold path. The path for an order with nothing to pay
-- (PAY-07, staff cash) is added with F03-T13.

create function app.reserve_court(
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
  s timestamptz;
begin
  -- 1 to 7 and 9: everything that can be decided without claiming (typed refusals).
  v_info := app.reserve_court_check(p_order, p_resource, p_starts, p_coach, p_override_reason);

  -- 2. A payment hold needs the hold setting; with none there is no default (BOOK-03-AC3).
  v_minutes := app.hold_minutes();
  if v_minutes is null then perform app.refuse('hold_setting_unset'); end if;
  v_expires := v_now + make_interval(mins => v_minutes);   -- one instant for the whole order (D46)

  select array_agg(x order by x) into v_sorted from unnest(p_starts) x;

  -- 10. Release expired holds in the way (FA 3.2), then claim every hour or none.
  perform app.release_expired_overlapping(p_resource, p_coach, v_sorted[1], v_sorted[cardinality(v_sorted)] + interval '1 hour');

  begin
    foreach s in array v_sorted loop
      insert into public.booking (
        club_id, order_id, type, resource_id, coach_id, start_at, end_at, customer_id, status, source,
        created_by, hold_expires_at, override_reason
      ) values (
        v_club, p_order, case when p_coach is null then 'court' else 'solo_class' end, p_resource, p_coach,
        s, s + interval '1 hour', (v_info ->> 'customer_id')::uuid, 'awaiting_payment', v_info ->> 'source',
        v_user, v_expires, p_override_reason
      ) returning id into v_id;
      insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, hold_expires_at, booking_id)
      values (
        v_club, case when p_coach is null then 'court_booking' else 'solo_class' end, p_resource, p_coach,
        s, s + interval '1 hour', 'held', v_expires, v_id
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
