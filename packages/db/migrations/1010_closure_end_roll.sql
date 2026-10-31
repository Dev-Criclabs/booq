-- F09-T08b / migration 1010: app.end_closure, app.roll_closure, app.closures_due_roll; app.closure_apply shared with
-- app.create_closure. F09 design 4.7, 4.8, 8. Requirements: CANCEL-03-AC9, AC10, AC11, AC12; assumption A-8; D159.
--
--   * app.closure_apply(closure, courts, occurrences, reason, limit): steps 2 to 5 of create_closure (1009), now shared
--     with the roll. Unchanged except that group sessions are cancelled with F08's reason 'closure' (0919), which lets
--     the worker cancel them and returns seat value with the closure kind.
--   * app.create_closure: 1009's checks and the closure rows, then closure_apply. Result unchanged.
--   * app.cancel_outcome: 1004's text, but the worker (booq_worker) counts as the club, so cancel_booking with a closure
--     runs in the roll job (cancel_booking already allowed the worker for a closure).
--   * app.end_closure(closure, new_end null, reason) (AC11): front desk and owner, a written reason, audited. new_end
--     null ends it now: status ended, and its closed slots from now on are deleted (one in progress ends now). A new_end
--     after now shortens it: a one off closure gets range_end = new_end; a repeat closure stops with its last occurrence
--     that starts before new_end (its rule gains an until, or an earlier one; new_end after the range start always
--     leaves the first). Either way the closed slots from new_end on are deleted or cut at new_end, under the court locks.
--     Cancelled bookings are not restored. Refusals closure:not_found, not_active, invalid_range, reason_required.
--   * app.closures_due_roll() lists the active repeat closures with an occurrence the booking window now reaches that
--     has no closed slot of the closure yet; app.roll_closure(closure) adds those occurrences through closure_apply, so a
--     booking found there (a staff booking made beyond the window, A-8) is cancelled by the same routine (AC9). One
--     closure per transaction: the court locks are the last locks a transaction takes (FA 3.4), and a second closure
--     in the same transaction would take customer locks after them. Run twice, the second finds nothing (idempotent).
--     The closure_roll job (F09-T10) calls them per club with the worker role; staff may call roll_closure too.
-- Redefines cancel_outcome (1004) and create_closure (1009), so numbered above both (D159).

create or replace function app.cancel_outcome(p_booking uuid, p_by_staff boolean default false, p_club_cancel boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_now timestamptz := app.now();
  -- The closure roll job (booq_worker) cancels as the club (1010); it acts for no person.
  v_staff boolean := app.has_any_role('owner', 'front_desk') or coalesce(current_setting('role', true), '') = 'booq_worker';
  b public.booking%rowtype;
  o public.orders%rowtype;
  v_window_text text;
  v_window integer;
  v_full boolean;
  v_outcome text;
  v_returned boolean;
  l record;
  v_lost integer;
  v_lines jsonb := '[]'::jsonb;
  v_lost_total integer := 0;
  v_forfeit_credits integer := 0;
  v_forfeit_wallet integer := 0;
  v_forfeit_money integer := 0;
  v_code_restore boolean;
begin
  if v_club is null then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if (coalesce(p_by_staff, false) or coalesce(p_club_cancel, false)) and not v_staff then
    raise exception 'cancel:forbidden' using errcode = 'P0001';
  end if;
  select * into b from public.booking where club_id = v_club and id = p_booking;
  if not found or (not v_staff and (v_user is null or b.customer_id is distinct from v_user)) then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'cancel:not_confirmed' using errcode = 'P0001';
  end if;
  if b.start_at <= v_now then
    raise exception 'cancel:started' using errcode = 'P0001';
  end if;

  v_full := coalesce(p_club_cancel, false)
            or (b.type = 'solo_class' and app.coach_was_changed(b.id))
            or (b.type = 'class_seat' and exists (select 1 from public.class_session s
                                                   where s.club_id = v_club and s.id = b.class_session_id and s.edited));
  v_window_text := app.club_setting_text('cancel_window_hours');
  if v_window_text is not null and v_window_text <> '' then
    v_window := v_window_text::integer;
  end if;
  if v_full then
    v_outcome := 'full';
  elsif v_window is null then
    raise exception 'cancel:window_unset' using errcode = 'P0001';
  elsif b.start_at - v_now >= make_interval(hours => v_window) then
    v_outcome := 'in_time';
  else
    v_outcome := 'late';
  end if;
  v_returned := v_outcome <> 'late';

  for l in select ol.id, ol.kind, ol.credit_units, ol.wallet_satang, ol.money_satang,
                  (ol.credit_package_id is not null and exists (
                     select 1 from public.customer_package cp
                      where cp.club_id = v_club and cp.id = ol.credit_package_id and cp.expires_at <= v_now)) as expired
             from public.order_line ol
            where ol.club_id = v_club and ol.booking_id = b.id
            order by ol.position loop
    v_lost := case when v_outcome = 'in_time' and l.expired then l.credit_units else 0 end;
    v_lost_total := v_lost_total + v_lost;
    if not v_returned then
      v_forfeit_credits := v_forfeit_credits + l.credit_units;
      v_forfeit_wallet := v_forfeit_wallet + l.wallet_satang;
      v_forfeit_money := v_forfeit_money + l.money_satang;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line', l.id,
      'kind', l.kind,
      'credits', case when v_returned then l.credit_units - v_lost else 0 end,
      'walletSatang', case when v_returned then l.wallet_satang else 0 end,
      'moneyToWalletSatang', case when v_returned then l.money_satang else 0 end));
  end loop;

  select * into o from public.orders where club_id = v_club and id = b.order_id;
  v_code_restore := v_returned
    and (o.promo_code_id is not null or coalesce(o.birthday_entitlement, false))
    and not exists (select 1 from public.booking x where x.club_id = v_club and x.order_id = b.order_id and x.id <> b.id
                      and x.status in ('confirmed', 'awaiting_payment'));

  return jsonb_build_object(
    'outcome', v_outcome,
    'windowHours', v_window,
    'returned', v_returned,
    'forfeited', not v_returned,
    'lines', v_lines,
    'forfeit', jsonb_build_object('credits', v_forfeit_credits, 'walletSatang', v_forfeit_wallet, 'moneySatang', v_forfeit_money),
    'creditLost', v_lost_total,
    'codeRestore', v_code_restore);
end $$;
alter function app.cancel_outcome(uuid, boolean, boolean) owner to booq_owner;
revoke all on function app.cancel_outcome(uuid, boolean, boolean) from public;
grant execute on function app.cancel_outcome(uuid, boolean, boolean) to booq_app, booq_worker;

-- Steps 2 to 5 of a closure over these courts and occurrences (1009 header). No grant: create_closure and roll_closure.
create function app.closure_apply(p_closure uuid, p_resources uuid[], p_occs tstzrange[], p_reason text, p_limit integer default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_span tstzmultirange;
  v_bookings uuid[];
  v_orders uuid[];
  v_sessions uuid[];
  v_count integer;
  v_cancelled uuid[] := '{}';
  v_released integer := 0;
  v_free tstzmultirange;
  v_rows integer := 0;
  v_id uuid;
  v_r jsonb;
  occ tstzrange;
  r uuid;
  part tstzrange;
begin
  select coalesce(range_agg(tstzrange(greatest(lower(x), v_now), upper(x), '[)')), '{}'::tstzmultirange) into v_span
    from unnest(p_occs) x where upper(x) > v_now;

  -- What the closure touches, read before any lock.
  select coalesce(array_agg(b.id order by b.id) filter (where b.status = 'confirmed' and b.start_at > v_now), '{}'),
         coalesce(array_agg(distinct b.order_id) filter (where b.status = 'awaiting_payment'), '{}')
    into v_bookings, v_orders
    from public.booking b
   where b.club_id = v_club and b.type in ('court', 'solo_class') and b.resource_id = any (p_resources)
     and b.status in ('confirmed', 'awaiting_payment') and tstzrange(b.start_at, b.end_at, '[)') && v_span;
  select coalesce(array_agg(s.id order by s.id), '{}') into v_sessions
    from public.class_session s
   where s.club_id = v_club and s.resource_id = any (p_resources) and s.status <> 'cancelled' and s.start_at > v_now
     and tstzrange(s.start_at, s.end_at, '[)') && v_span;

  if p_limit is not null then
    select cardinality(v_bookings)
           + (select count(*) from public.booking b where b.club_id = v_club and b.order_id = any (v_orders) and b.status = 'awaiting_payment'
                and b.type in ('court', 'solo_class') and b.resource_id = any (p_resources) and tstzrange(b.start_at, b.end_at, '[)') && v_span)
           + (select count(*) from public.booking b where b.club_id = v_club and b.class_session_id = any (v_sessions) and b.status in ('awaiting_payment', 'confirmed'))
      into v_count;
    if v_count > p_limit then
      raise exception 'closure:too_many' using errcode = 'P0001', detail = v_count::text;
    end if;
  end if;

  -- 2. Locks in FA 3.4 order.
  perform app.lock_customer(c) from (
    select distinct customer_id as c from public.booking
     where club_id = v_club and customer_id is not null
       and (id = any (v_bookings) or order_id = any (v_orders) or (class_session_id = any (v_sessions) and status in ('awaiting_payment', 'confirmed')))
     union
    select customer_id from public.orders where club_id = v_club and id = any (v_orders) and customer_id is not null
     order by 1) x;
  perform app.lock_coach(c) from (
    select coach_id as c from public.booking where club_id = v_club and id = any (v_bookings) and coach_id is not null
     union
    select coach_id from public.class_session where club_id = v_club and id = any (v_sessions)
     order by 1) x;
  perform 1 from public.booking where club_id = v_club and id = any (v_bookings) order by id for update;

  -- 3. Cancel, release, cancel sessions.
  for v_id in select unnest(v_bookings) order by 1 loop
    v_r := app.cancel_booking(v_id, true, true, p_reason, p_closure);
    if not coalesce((v_r ->> 'repeated')::boolean, false) then
      v_cancelled := v_cancelled || v_id;
    end if;
  end loop;
  for v_id in select unnest(v_orders) order by 1 loop
    if app.release_hold(v_id, 'closed') then
      v_released := v_released + 1;
    end if;
  end loop;
  for v_id in select unnest(v_sessions) order by 1 loop
    perform app.cancel_session(v_id, 'closure');
  end loop;

  -- 4. The court locks, last; then nothing new may stand in the range.
  perform app.lock_resource(x) from (select distinct x from unnest(p_resources) x order by 1) y;
  if exists (select 1 from public.occupancy oc
              where oc.club_id = v_club and oc.resource_id = any (p_resources) and oc.kind <> 'closure' and oc.start_at > v_now
                and tstzrange(oc.start_at, oc.end_at, '[)') && v_span) then
    raise exception 'closure:busy' using errcode = '40001';
  end if;

  -- 5. The closed slots: each occurrence on each court, after now, around what has started and other closures.
  begin
    for occ in select x from unnest(p_occs) x where upper(x) > v_now order by lower(x) loop
      for r in select distinct x from unnest(p_resources) x order by 1 loop
        select tstzmultirange(tstzrange(greatest(lower(occ), v_now), upper(occ), '[)'))
               - coalesce(range_agg(tstzrange(oc.start_at, oc.end_at, '[)')), '{}'::tstzmultirange)
          into v_free
          from public.occupancy oc
         where oc.club_id = v_club and oc.resource_id = r
           and tstzrange(oc.start_at, oc.end_at, '[)') && tstzrange(greatest(lower(occ), v_now), upper(occ), '[)');
        for part in select unnest(v_free) loop
          insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, closure_id)
          values (v_club, 'closure', r, lower(part), upper(part), 'confirmed', p_closure);
          v_rows := v_rows + 1;
        end loop;
      end loop;
    end loop;
  exception when exclusion_violation then
    raise exception 'closure:busy' using errcode = '40001';
  end;

  return jsonb_build_object('cancelled', cardinality(v_cancelled), 'released', v_released, 'sessions', cardinality(v_sessions),
                            'slots', v_rows, 'cancelledIds', to_jsonb(v_cancelled));
end $$;
alter function app.closure_apply(uuid, uuid[], tstzrange[], text, integer) owner to booq_owner;
revoke all on function app.closure_apply(uuid, uuid[], tstzrange[], text, integer) from public;

create or replace function app.create_closure(
  p_resources uuid[], p_start timestamptz, p_end timestamptz, p_rule jsonb, p_reason text, p_limit integer default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_closure uuid;
  v_r jsonb;
begin
  perform app.closure_span(p_resources, p_start, p_end, p_rule);   -- the checks (1009)
  if v_reason is null then
    raise exception 'closure:reason_required' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', v_reason, true);

  -- 1. The definition, which the cancel records point at.
  insert into public.closure (club_id, reason, range_start, range_end, repeat_rule, created_by)
  values (v_club, v_reason, p_start, p_end, p_rule, app.user_id())
  returning id into v_closure;
  insert into public.closure_resource (club_id, closure_id, resource_id)
  select distinct v_club, v_closure, x from unnest(p_resources) x;

  v_r := app.closure_apply(v_closure, p_resources,
                           array(select tstzrange(o.occ_start, o.occ_end, '[)') from app.closure_occurrences(p_start, p_end, p_rule) o),
                           v_reason, p_limit);
  return jsonb_build_object('closure', v_closure, 'cancelled', v_r -> 'cancelled', 'released', v_r -> 'released',
                            'sessions', v_r -> 'sessions', 'slots', v_r -> 'slots',
                            'expiredPackages', app.closure_expired_packages(array(select jsonb_array_elements_text(v_r -> 'cancelledIds')::uuid)));
end $$;

create function app.end_closure(p_closure uuid, p_new_end timestamptz default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_now timestamptz := app.now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  c public.closure%rowtype;
  v_cut timestamptz;
  v_first date;
  v_day date;
  v_until date;
  v_ended boolean;
  v_freed integer;
  v_cut_rows integer;
begin
  if v_club is null or v_user is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'closure:forbidden' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'closure:reason_required' using errcode = 'P0001';
  end if;
  select * into c from public.closure where club_id = v_club and id = p_closure for update;
  if not found then
    raise exception 'closure:not_found' using errcode = 'P0001';
  end if;
  if c.status <> 'active' then
    raise exception 'closure:not_active' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', v_reason, true);

  v_cut := coalesce(p_new_end, v_now);
  v_ended := p_new_end is null;
  if p_new_end is not null then
    if p_new_end <= v_now or p_new_end <= c.range_start or (c.repeat_rule is null and p_new_end >= c.range_end) then
      raise exception 'closure:invalid_range' using errcode = 'P0001';
    end if;
    if c.repeat_rule is null then
      update public.closure set range_end = p_new_end where club_id = v_club and id = c.id;
    else
      -- The last occurrence is the one on new_end's Bangkok day if it starts before new_end, else the day before.
      v_first := (c.range_start at time zone 'Asia/Bangkok')::date;
      v_day := (p_new_end at time zone 'Asia/Bangkok')::date;
      v_until := case when c.range_start + (v_day - v_first) * interval '1 day' >= p_new_end then v_day - 1 else v_day end;
      if c.repeat_rule ? 'until' then
        v_until := least(v_until, (c.repeat_rule ->> 'until')::date);
      end if;
      update public.closure set repeat_rule = c.repeat_rule || jsonb_build_object('until', to_char(v_until, 'YYYY-MM-DD'))
       where club_id = v_club and id = c.id;
    end if;
  end if;
  if v_ended then
    update public.closure set status = 'ended', ended_by = v_user, ended_at = v_now where club_id = v_club and id = c.id;
  end if;

  -- The slots from the cut on are free again (AC11); cancelled bookings stay cancelled.
  perform app.lock_resource(x) from (select resource_id as x from public.closure_resource
                                      where club_id = v_club and closure_id = c.id order by 1) y;
  delete from public.occupancy where club_id = v_club and closure_id = c.id and start_at >= v_cut;
  get diagnostics v_freed = row_count;
  update public.occupancy set end_at = v_cut where club_id = v_club and closure_id = c.id and start_at < v_cut and end_at > v_cut;
  get diagnostics v_cut_rows = row_count;
  return jsonb_build_object('closure', c.id, 'status', case when v_ended then 'ended' else 'active' end, 'freed', v_freed + v_cut_rows);
end $$;
alter function app.end_closure(uuid, timestamptz, text) owner to booq_owner;
revoke all on function app.end_closure(uuid, timestamptz, text) from public;
grant execute on function app.end_closure(uuid, timestamptz, text) to booq_app;

-- The occurrences of an active repeat closure that the window reaches today and that have no closed slot of it yet.
create function app.closure_new_occurrences(c public.closure) returns tstzrange[]
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select coalesce(array_agg(tstzrange(o.occ_start, o.occ_end, '[)') order by o.occ_start), '{}')
    from app.closure_occurrences(c.range_start, c.range_end, c.repeat_rule) o
   where o.occ_end > app.now()
     and not exists (select 1 from public.occupancy oc
                      where oc.club_id = c.club_id and oc.closure_id = c.id
                        and tstzrange(oc.start_at, oc.end_at, '[)') && tstzrange(o.occ_start, o.occ_end, '[)'))
$$;
alter function app.closure_new_occurrences(public.closure) owner to booq_owner;
revoke all on function app.closure_new_occurrences(public.closure) from public;

create function app.closure_roll_allowed() returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select app.club_id() is not null and (coalesce(current_setting('role', true), '') = 'booq_worker'
         or (app.user_id() is not null and app.has_any_role('owner', 'front_desk')))
$$;
alter function app.closure_roll_allowed() owner to booq_owner;
revoke all on function app.closure_roll_allowed() from public;

create function app.closures_due_roll() returns uuid[]
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_window text := app.club_setting_text('booking_window_days');
begin
  if not app.closure_roll_allowed() then
    raise exception 'closure:forbidden' using errcode = 'P0001';
  end if;
  if v_window is null or v_window !~ '^\d+$' then
    return '{}';   -- no window, no occurrence to add (closure:window_unset at creation)
  end if;
  return (select coalesce(array_agg(c.id order by c.id), '{}') from public.closure c
           where c.club_id = app.club_id() and c.status = 'active' and c.repeat_rule is not null
             and cardinality(app.closure_new_occurrences(c)) > 0);
end $$;
alter function app.closures_due_roll() owner to booq_owner;
revoke all on function app.closures_due_roll() from public;
grant execute on function app.closures_due_roll() to booq_app, booq_worker;

create function app.roll_closure(p_closure uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_window text := app.club_setting_text('booking_window_days');
  c public.closure%rowtype;
  v_occs tstzrange[];
  v_r jsonb;
begin
  if not app.closure_roll_allowed() then
    raise exception 'closure:forbidden' using errcode = 'P0001';
  end if;
  -- The closure row first: two rolls, or a roll and an end, of one closure queue here.
  select * into c from public.closure where club_id = v_club and id = p_closure for update;
  if not found then
    raise exception 'closure:not_found' using errcode = 'P0001';
  end if;
  if c.status <> 'active' or c.repeat_rule is null or v_window is null or v_window !~ '^\d+$' then
    return jsonb_build_object('closure', c.id, 'added', 0);
  end if;
  v_occs := app.closure_new_occurrences(c);
  if cardinality(v_occs) = 0 then
    return jsonb_build_object('closure', c.id, 'added', 0);
  end if;
  perform set_config('app.reason', c.reason, true);
  v_r := app.closure_apply(c.id, array(select resource_id from public.closure_resource where club_id = v_club and closure_id = c.id order by 1),
                           v_occs, c.reason);
  return jsonb_build_object('closure', c.id, 'added', cardinality(v_occs), 'cancelled', v_r -> 'cancelled', 'released', v_r -> 'released',
                            'sessions', v_r -> 'sessions', 'slots', v_r -> 'slots');
end $$;
alter function app.roll_closure(uuid) owner to booq_owner;
revoke all on function app.roll_closure(uuid) from public;
grant execute on function app.roll_closure(uuid) to booq_app, booq_worker;
