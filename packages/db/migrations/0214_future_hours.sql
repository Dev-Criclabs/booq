-- F03-T10 / migration 0214: the future hours limit. F03 design 4.4 and FA 3.4 step 0.
-- Requirements: BOOK-05-AC1 to AC8. Decisions D49, D59, D110, D111.
--
-- app.future_hours(customer) counts the customer's hours that have not ended: unpaid held (hold
-- not expired), confirmed, court or solo class, staff made ones included. Group class seats and
-- played hours are not counted. The check runs inside the booking transaction after the
-- customer's advisory lock, so two parallel requests from one player at N minus 1 let exactly
-- one through (BOOK-05-AC4). An unset max_future_court_hours means no limit and no default.
-- Staff (owner, front desk) may go over with a written reason, stored on the booking and so
-- audited with it; a player cannot (the override reason from a player is refused by the check).

-- The limit N, or null for no limit. A stored value that is not a whole number of 1 or more is a
-- corrupt setting and raises.
create function app.max_future_court_hours() returns integer
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare v text := app.club_setting_text('max_future_court_hours');
begin
  if v is null or v = '' or v = 'null' then return null; end if;
  if v !~ '^[1-9][0-9]*$' then
    raise exception 'max_future_court_hours must be a whole number of 1 or more' using errcode = '22023';
  end if;
  return v::integer;
end $$;
alter function app.max_future_court_hours() owner to booq_owner;
revoke all on function app.max_future_court_hours() from public;
grant execute on function app.max_future_court_hours() to booq_app, booq_worker;

create function app.future_hours(p_customer uuid) returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select count(*)::integer from public.booking
   where club_id = app.club_id() and customer_id = p_customer
     and type in ('court', 'solo_class')
     and end_at > app.now()
     and (status = 'confirmed' or (status = 'awaiting_payment' and hold_expires_at > app.now()))
$$;
alter function app.future_hours(uuid) owner to booq_owner;
revoke all on function app.future_hours(uuid) from public;
grant execute on function app.future_hours(uuid) to booq_app, booq_worker;

create function app.lock_customer(p_customer uuid) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ select pg_advisory_xact_lock(hashtextextended('customer:' || app.club_id()::text || ':' || p_customer::text, 0)) $$;
alter function app.lock_customer(uuid) owner to booq_owner;
revoke all on function app.lock_customer(uuid) from public;

-- reserve_court with the limit step (design 4.2 step 8) between the checks and the coach.
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
  s timestamptz;
begin
  -- 1 to 7: everything that can be decided without claiming (typed refusals).
  v_info := app.reserve_court_check(p_order, p_resource, p_starts, null, p_override_reason);

  -- 2. A payment hold needs the hold setting; with none there is no default (BOOK-03-AC3).
  v_minutes := app.hold_minutes();
  if v_minutes is null then perform app.refuse('hold_setting_unset'); end if;
  v_expires := v_now + make_interval(mins => v_minutes);   -- one instant for the whole order (D46)

  select array_agg(x order by x) into v_sorted from unnest(p_starts) x;

  -- 8. The future hours limit (BOOK-05). The customer's lock comes first in the lock order (step 0).
  v_override := null;
  v_customer := (v_info ->> 'customer_id')::uuid;
  v_limit := app.max_future_court_hours();
  if v_limit is not null and v_customer is not null then
    perform app.lock_customer(v_customer);
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
