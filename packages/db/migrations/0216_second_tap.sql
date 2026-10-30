-- F03-T11 / migration 0216: the second tap. F03 design 4.3 (second tap) and FA 3.5.
-- Requirement: BOOK-03-AC15. Decision D47.
--
-- Before claiming (and before the future hours limit, which would count the player's own hold
-- against them), reserve_court looks for the caller's own live awaiting_payment order for the
-- identical selection (same court, same hours, same coach). If there is one it returns that order,
-- its bookings and its original hold end, with reused = true, and creates nothing: a second tap, or
-- a tap on a second device, gets the same hold. The new empty order row the caller made is left to
-- the caller (F04 rolls it back or cancels it). The customer's advisory lock is taken first
-- (lock order step 0), so identical requests in parallel run one after the other and the later
-- ones find the first one's hold.

-- reserve_court with the second tap lookup (after the checks, before the limit).
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
  s timestamptz;
begin
  -- 1 to 7: everything that can be decided without claiming (typed refusals).
  v_info := app.reserve_court_check(p_order, p_resource, p_starts, null, p_override_reason);

  -- 2. A payment hold needs the hold setting; with none there is no default (BOOK-03-AC3).
  v_minutes := app.hold_minutes();
  if v_minutes is null then perform app.refuse('hold_setting_unset'); end if;
  v_expires := v_now + make_interval(mins => v_minutes);   -- one instant for the whole order (D46)

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
        created_by, hold_expires_at, override_reason
      ) values (
        v_club, p_order, case when p_coach is null then 'court' else 'solo_class' end, p_resource, p_coach,
        s, s + interval '1 hour', (v_info ->> 'customer_id')::uuid, 'awaiting_payment', v_info ->> 'source',
        v_user, v_expires, v_override
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
