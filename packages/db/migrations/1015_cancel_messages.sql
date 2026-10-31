-- F09-T11 / migration 1015: the cancel and closure messages through F10's app.enqueue_message (0605). F09 design 4.9.
-- Requirements: CANCEL-01-AC14, CANCEL-03-AC2, AC5, AC7, AC15; LINE-05; decisions D9, D48, D118.
--
--   * cancellation_result (dedupe cancel:{booking}:{version}) to the player of every cancel but a closure's;
--     session_change (session:{booking}:{version}:{coach}) to the coach of a solo class, closure included (AC7);
--     both from app.cancel_booking, after the record. A staff mark sends no message (design 4.9).
--   * club_closed_slot (closure:{closure}:{booking}) to each player whose confirmed booking or payment hold in the
--     closed range the closure ended, from app.closure_apply after its cancels and releases; no cancellation_result for
--     those bookings and, because the release reason is closed, no booking_released (F10 skips it, D48). The seat
--     holders of a cancelled group session are told by F08's cancel_session.
--   * Params hold ids only (booking_id, closure_id); F10's message facts read the hour, court and coach (CC-3).
--     A person with no LINE link gets no row (enqueue_message returns null); the outbox sends after the commit, and a
--     send that fails is the outbox's status: the cancel stands (AC15, D9).
--   * app.closure_unmessaged(closure): front desk and owner; the players of the closure's club_closed_slot messages
--     whose status is failed or undeliverable, with their names (staff only, CC-3), read from the outbox (no table).
--   * D175: closure_apply passes its closure to app.cancel_session (the Architect's 1014), so each seat a closure cancels
--     carries closure_id on its cancel record. roll_closure reaches cancel_session only through closure_apply.
-- Redefines app.cancel_booking (last 1012) and app.closure_apply (1010), and calls 1014's cancel_session, so numbered above
-- them (D159); 1013 and 1014 are the Architect's cancel_session files.

create or replace function app.cancel_booking(
  p_booking uuid, p_by_staff boolean default false, p_club_cancel boolean default false, p_reason text default null, p_closure uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_customer uuid;
  v_coach uuid;
  b public.booking%rowtype;
  v_last public.booking_cancel%rowtype;
  v_outcome jsonb;
  v_kind text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_returned jsonb;
  v_version integer;
  v_id uuid;
  v_late boolean;
begin
  if v_club is null then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if p_closure is not null and not (v_staff or coalesce(current_setting('role', true), '') = 'booq_worker') then
    raise exception 'cancel:forbidden' using errcode = 'P0001';
  end if;

  -- 1. Locks, then the status again under them.
  select customer_id, coach_id into v_customer, v_coach from public.booking where club_id = v_club and id = p_booking;
  if not found then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if not v_staff and p_closure is null and (v_user is null or v_customer is distinct from v_user) then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  if v_customer is not null then
    perform app.lock_customer(v_customer);
  end if;
  if v_coach is not null then
    perform app.lock_coach(v_coach);
  end if;
  select * into b from public.booking where club_id = v_club and id = p_booking for update;

  if b.status in ('cancelled', 'late_cancelled') then
    select * into v_last from public.booking_cancel c where c.club_id = v_club and c.booking_id = b.id order by c.version desc limit 1;
    if found then
      return jsonb_build_object('bookingCancel', v_last.id, 'version', v_last.version, 'kind', v_last.kind,
                                'outcome', case when v_last.outcome = 'forfeited' then 'late' else coalesce(v_last.returned ->> 'outcome', 'in_time') end,
                                'returned', v_last.returned, 'repeated', true);
    end if;
    raise exception 'cancel:not_confirmed' using errcode = 'P0001';
  end if;
  if b.status = 'awaiting_payment' then
    raise exception 'cancel:hold' using errcode = 'P0001';
  end if;

  -- 2. The outcome (refuses not confirmed, started, not found, forbidden).
  v_outcome := app.cancel_outcome(b.id, coalesce(p_by_staff, false) or p_closure is not null,
                                  coalesce(p_club_cancel, false) or p_closure is not null);

  -- 3. The kind, the reason and the value.
  v_kind := case when p_closure is not null then 'closure'
                 when coalesce(p_club_cancel, false) then 'club_cancel'
                 when coalesce(p_by_staff, false) then 'staff_cancel'
                 else 'player_cancel' end;
  if v_kind <> 'player_cancel' then
    if v_reason is null then
      raise exception 'cancel:reason_required' using errcode = 'P0001';
    end if;
    perform set_config('app.reason', v_reason, true);
  else
    v_reason := null;
  end if;
  v_late := (v_outcome ->> 'outcome') = 'late';
  v_returned := app.return_booking_value(b.id, case when v_late then 'late_cancel_mark' else v_kind end);

  -- 4. Status, the slot, the order.
  update public.booking
     set status = case when v_late then 'late_cancelled' else 'cancelled' end, updated_at = app.now()
   where club_id = v_club and id = b.id;
  delete from public.occupancy where club_id = v_club and booking_id = b.id;
  perform app.cancel_order_effects(b.id, case when v_late then 'late_cancel_mark' else v_kind end);

  -- 5. The record, through the one writer (1012).
  v_returned := v_returned || jsonb_build_object('outcome', v_outcome ->> 'outcome');
  v_id := app.record_booking_cancel(b.id, v_kind, case when v_late then 'forfeited' else 'returned' end, v_returned, v_reason, p_closure);
  select c.version into v_version from public.booking_cancel c where c.club_id = v_club and c.id = v_id;

  -- 6. Handlers and reminders.
  perform app.run_cancel_handlers(b.id, v_kind);
  perform app.void_messages('reminder:' || b.id::text || ':', 'cancelled');

  -- 7. The messages (F09-T11, design 4.9), held by the commit; ids only in params. A closure's own message is
  --    club_closed_slot, sent by app.closure_apply; every other cancel tells the player its result. The coach of a solo
  --    class is told either way (CANCEL-03-AC7). enqueue_message skips a person with no LINE link, and a send that fails
  --    later is the outbox's: it never undoes this cancel.
  if v_kind <> 'closure' then
    perform app.enqueue_message('cancellation_result', b.customer_id, jsonb_build_object('booking_id', b.id),
                                'cancel:' || b.id::text || ':' || v_version::text, null);
  end if;
  if b.coach_id is not null then
    perform app.enqueue_message('session_change', b.coach_id, jsonb_build_object('booking_id', b.id),
                                'session:' || b.id::text || ':' || v_version::text || ':' || b.coach_id::text, null);
  end if;

  return jsonb_build_object('bookingCancel', v_id, 'version', v_version, 'kind', v_kind, 'outcome', v_outcome ->> 'outcome',
                            'returned', v_returned, 'repeated', false);
end $$;
alter function app.cancel_booking(uuid, boolean, boolean, text, uuid) owner to booq_owner;
revoke all on function app.cancel_booking(uuid, boolean, boolean, text, uuid) from public;
grant execute on function app.cancel_booking(uuid, boolean, boolean, text, uuid) to booq_app, booq_worker;

create or replace function app.closure_apply(p_closure uuid, p_resources uuid[], p_occs tstzrange[], p_reason text, p_limit integer default null)
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
  v_held uuid[];
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
  -- The holds' bookings in the range, read before the release: their players are told the slot is closed (AC5).
  select coalesce(array_agg(b.id order by b.id), '{}') into v_held
    from public.booking b
   where b.club_id = v_club and b.order_id = any (v_orders) and b.status = 'awaiting_payment'
     and b.type in ('court', 'solo_class') and b.resource_id = any (p_resources) and tstzrange(b.start_at, b.end_at, '[)') && v_span;
  for v_id in select unnest(v_orders) order by 1 loop
    if app.release_hold(v_id, 'closed') then
      v_released := v_released + 1;
    end if;
  end loop;
  for v_id in select unnest(v_sessions) order by 1 loop
    perform app.cancel_session(v_id, 'closure', p_closure);
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

  -- 6. One Club closed message per player booking or hold the closure ended (design 4.9, LINE-05). Seat holders of a
  --    cancelled session are told by F08's cancel_session.
  perform app.enqueue_message('club_closed_slot', b.customer_id, jsonb_build_object('booking_id', b.id, 'closure_id', p_closure),
                              'closure:' || p_closure::text || ':' || b.id::text, null)
     from public.booking b
    where b.club_id = v_club and (b.id = any (v_cancelled) or b.id = any (v_held))
    order by b.id;

  return jsonb_build_object('cancelled', cardinality(v_cancelled), 'released', v_released, 'sessions', cardinality(v_sessions),
                            'slots', v_rows, 'cancelledIds', to_jsonb(v_cancelled));
end $$;
alter function app.closure_apply(uuid, uuid[], tstzrange[], text, integer) owner to booq_owner;
revoke all on function app.closure_apply(uuid, uuid[], tstzrange[], text, integer) from public;


create function app.closure_unmessaged(p_closure uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'closure:forbidden' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('customerId', m.user_id, 'customerName', app.closure_person_name(m.user_id),
                                                       'bookingId', (m.params ->> 'booking_id')::uuid, 'status', m.status)
                                    order by app.closure_person_name(m.user_id), m.user_id, m.dedupe_key), '[]'::jsonb)
            from public.message_outbox m
           where m.club_id = v_club and m.kind = 'club_closed_slot' and m.dedupe_key like 'closure:' || p_closure::text || ':%'
             and m.status in ('failed', 'undeliverable'));
end $$;
alter function app.closure_unmessaged(uuid) owner to booq_owner;
revoke all on function app.closure_unmessaged(uuid) from public;
grant execute on function app.closure_unmessaged(uuid) to booq_app;
