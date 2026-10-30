-- F03-T12 / migration 0228: the limit on repeated Pay taps. F03 design 4.2 step 1b and 4.8; decision D61;
-- assumption A-11 (the pay_tap_limit_set launch check is F01-T27b's, migration 0046).
--
--   * public.pay_tap (club_id, user_id, at, is_test): one row per reserve_court call that creates a new hold,
--     written in the same transaction, so a refused attempt leaves no row. Written only by reserve_court
--     (SECURITY DEFINER); no app role reads or writes it. Class D.
--   * platform.config keys pay_tap_limit_count and pay_tap_limit_window_seconds: Security sets them; no value is
--     shipped (CLAUDE.md: never invent a setting). Unset, or not a positive number, means the limit is off,
--     and the launch check keeps the club from going Live until both are set.
--   * reserve_court refuses with too_many_attempts (BK001, detail = whole seconds to wait) when the caller already
--     has the limit's number of attempts inside the window. reserve_court is 0217's text with the check added
--     after the second tap lookup (a second tap is not an attempt, D47) and before any claim. Numbered above
--     0217, the last definition of reserve_court (D159).
--   * app.prune_pay_taps(): the housekeeping task drops the context club's attempts that have left the window
--     (all of them while the limit is unset); they no longer count for anything.

create table public.pay_tap (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  at timestamptz not null,
  is_test boolean not null default false,
  primary key (club_id, id)
);
create index pay_tap_user_at on public.pay_tap (club_id, user_id, at);

alter table public.pay_tap owner to booq_owner;
alter table public.pay_tap enable row level security;
alter table public.pay_tap force row level security;
revoke all on public.pay_tap from public;
create policy pay_tap_tenant on public.pay_tap as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy pay_tap_definer on public.pay_tap for all to booq_owner using (true) with check (true);

select app.register_test_table('public.pay_tap', 400);

-- The platform values, or null when unset or not a positive whole number.
create function app.pay_tap_limit_count() returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 then floor((value #>> '{}')::numeric)::integer end
    from platform.config where key = 'pay_tap_limit_count'
$$;
create function app.pay_tap_limit_window_seconds() returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 then floor((value #>> '{}')::numeric)::integer end
    from platform.config where key = 'pay_tap_limit_window_seconds'
$$;
alter function app.pay_tap_limit_count() owner to booq_owner;
alter function app.pay_tap_limit_window_seconds() owner to booq_owner;
revoke all on function app.pay_tap_limit_count() from public;
revoke all on function app.pay_tap_limit_window_seconds() from public;

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

create function app.prune_pay_taps() returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_window integer := app.pay_tap_limit_window_seconds();
  v_n integer;
begin
  if v_club is null then
    raise exception 'prune_pay_taps needs a club in the context' using errcode = '42501';
  end if;
  delete from public.pay_tap
   where club_id = v_club and (v_window is null or app.pay_tap_limit_count() is null or at <= app.now() - make_interval(secs => v_window));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
alter function app.prune_pay_taps() owner to booq_owner;
revoke all on function app.prune_pay_taps() from public;
grant execute on function app.prune_pay_taps() to booq_worker;
