-- F03-T09 / migration 0213: the solo class path. F03 design 4.2 step 9 and 4.3; FA 3.3, 3.4.
-- Requirements: BOOK-03-AC11, BOOK-04-AC2, AC3, AC10. Decision D19. Assumption A-8.
--
-- A request with a coach: lock the coach (lock order step 1), ask F07's rules, then claim court
-- and coach in one occupancy row per hour, so one exclusion violation on either undoes both
-- (BOOK-04-AC3). The coach table is F07's and does not exist yet, so two things are hooks:
--   * app.lock_coach(coach) serialises decisions about one coach with an advisory transaction
--     lock; F07 replaces it with SELECT ... FROM coach WHERE ... FOR UPDATE when the table exists;
--   * app.coach_rules_check is a registered function (club, coach, resource, starts[]) that
--     refuses with app.refuse('coach_unavailable' | 'rest_rule'); F07 registers it and must also
--     check the coach belongs to the club. Until it is registered, a coach request is refused
--     with coach_rules_not_installed, so a coach can never be held without the rules.
-- The foreign key from booking.coach_id and occupancy.coach_id to coach is added by F07.

create table app.coach_rules_hook (
  only_row boolean primary key default true check (only_row),
  handler regproc not null
);
alter table app.coach_rules_hook owner to booq_owner;
revoke all on app.coach_rules_hook from public;

create function app.register_coach_rules(p_handler regproc) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ insert into app.coach_rules_hook (handler) values (p_handler)
      on conflict (only_row) do update set handler = excluded.handler $$;
alter function app.register_coach_rules(regproc) owner to booq_owner;
revoke all on function app.register_coach_rules(regproc) from public;

create function app.lock_coach(p_coach uuid) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ select pg_advisory_xact_lock(hashtextextended('coach:' || app.club_id()::text || ':' || p_coach::text, 0)) $$;
alter function app.lock_coach(uuid) owner to booq_owner;
revoke all on function app.lock_coach(uuid) from public;

-- reserve_court with the coach step. Same signature as 0212; the checks that need no coach run
-- first (the check function is called without the coach and the coach is handled here).
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
  s timestamptz;
begin
  -- 1 to 7: everything that can be decided without claiming (typed refusals).
  v_info := app.reserve_court_check(p_order, p_resource, p_starts, null, p_override_reason);

  -- 2. A payment hold needs the hold setting; with none there is no default (BOOK-03-AC3).
  v_minutes := app.hold_minutes();
  if v_minutes is null then perform app.refuse('hold_setting_unset'); end if;
  v_expires := v_now + make_interval(mins => v_minutes);   -- one instant for the whole order (D46)

  select array_agg(x order by x) into v_sorted from unnest(p_starts) x;

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
