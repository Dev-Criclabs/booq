-- F08 / migration 1014: app.cancel_session takes the closure that cancels it (D175; orchestrator note). The optional third argument is passed to
-- app.record_booking_cancel, so a seat cancelled by a closure carries closure_id; every other caller leaves it null and is unchanged. A closure id
-- is allowed with any reason but only means something for 'closure' and the closure create, which cancels with 'owner'. Adding a parameter
-- makes a new function, so the two argument one of 1013 is dropped and made again with the same body (D159).
drop function app.cancel_session(uuid, text);
create function app.cancel_session(p_session uuid, p_reason text, p_closure uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s public.class_session%rowtype;
  b record;
  e record;
  v_seats integer := 0;
  v_entries integer := 0;
  v_coach uuid;
  v_closure boolean;
  v_kind text;
  v_returned jsonb;
begin
  v_closure := p_reason = 'closure';
  v_kind := case when v_closure then 'closure' else 'club_cancel' end;
  -- The closure roll job (F09) cancels with the worker role and no person; every other reason is a staff action.
  if v_club is null or not (
       (v_closure and coalesce(current_setting('role', true), '') = 'booq_worker')
       or (app.user_id() is not null and app.has_any_role('owner', 'front_desk'))) then
    raise exception 'session: not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('below_minimum', 'owner', 'template', 'coach', 'closure') then
    raise exception 'session: invalid reason' using errcode = 'P0001';
  end if;
  select coach_id into v_coach from public.class_session where club_id = v_club and id = p_session;
  if v_coach is null then perform app.refuse('session_not_available'); end if;
  perform app.lock_coach(v_coach);
  select * into s from public.class_session where club_id = v_club and id = p_session for update;
  if s.status = 'cancelled' then return jsonb_build_object('seats', 0, 'entries', 0, 'repeated', true); end if;
  if s.start_at <= app.now() then perform app.refuse('hour_started'); end if;

  -- The session is cancelled first, so the release handlers that run below (the waitlist advance among them) see a cancelled session.
  update public.class_session set status = 'cancelled', attention_reason = null, cancel_reason = p_reason, cancelled_by = app.user_id(), cancelled_at = app.now()
   where club_id = v_club and id = p_session;
  -- The waiting list ends with the session.
  for e in select id, customer_id from public.waitlist_entry
            where club_id = v_club and class_session_id = p_session and status in ('waiting', 'offered') order by id for update loop
    update public.waitlist_entry set status = 'ended', ended_reason = 'session_cancelled' where club_id = v_club and id = e.id;
    v_entries := v_entries + 1;
    perform app.coach_message_hook('waitlist_ended', e.customer_id, jsonb_build_object('entry_id', e.id, 'session_id', p_session), 'waitlist_ended:' || e.id);
  end loop;
  -- The live seats, in id order; a paid seat gets its value back, a held seat (an open offer is one) is released.
  for b in select id, order_id, status, customer_id from public.booking
            where club_id = v_club and class_session_id = p_session and status in ('awaiting_payment', 'confirmed') order by id for update loop
    if b.status = 'confirmed' then
      update public.booking set status = 'cancelled', updated_at = app.now() where club_id = v_club and id = b.id;
      v_returned := app.return_seat_value(b.id, v_kind);
      -- One cancel record per paid seat (F09 design 3.1); the reason is the session's own cancel reason, which the table requires for these kinds.
      perform app.record_booking_cancel(b.id, v_kind, 'returned', v_returned, p_reason, p_closure);
    else
      perform app.release_hold(b.order_id, 'staff');
    end if;
    v_seats := v_seats + 1;
    perform app.coach_message_hook('cancellation_result', b.customer_id, jsonb_build_object('booking_id', b.id), 'cancellation_result:' || b.id);
  end loop;
  if s.status = 'scheduled' then
    perform app.lock_resource(s.resource_id);                  -- step 3c, last before the occupancy write
    delete from public.occupancy where club_id = v_club and class_session_id = p_session;
  end if;
  perform app.coach_message_hook('session_change', s.coach_id, jsonb_build_object('session_id', p_session), 'session_change:' || p_session || ':cancelled');
  return jsonb_build_object('seats', v_seats, 'entries', v_entries);
end $$;
alter function app.cancel_session(uuid, text, uuid) owner to booq_owner;
revoke all on function app.cancel_session(uuid, text, uuid) from public;
grant execute on function app.cancel_session(uuid, text, uuid) to booq_app, booq_worker;
