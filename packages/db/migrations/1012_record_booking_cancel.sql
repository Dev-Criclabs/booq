-- F09 helper / migration 1012: app.record_booking_cancel, the one writer of booking_cancel rows (F09 design 3.1).
-- Requirements: CANCEL-01-AC11, CANCEL-04-AC1 to AC3, AC12; F07 R5-AC5; decision D159.
--
-- F08's app.cancel_session cancels each paid seat and returns its value, but booking_cancel is F09's table, so class
-- cancellations had no cancel record. app.record_booking_cancel(booking, kind, outcome, returned, reason, closure null)
-- writes the next version row for a booking exactly as cancel_booking did: the order from the booking, credit_lost from
-- returned.creditLost, the trimmed reason (required for every kind but player_cancel, by the table's CHECK), who
-- (app.user_id()), the closure. The caller holds the booking row lock (FA 3.4 step 3), so versions never collide; the
-- unique (club, booking, version) refuses a second writer anyway. It writes the row only: handlers, messages and
-- returns stay with the caller. No app grant: definer functions call it (cancel_booking, the staff marks, F08's
-- cancel_session).
-- app.cancel_booking (last defined in 1007) and app.mark_record (1008) now write through it; their results are unchanged.
-- Numbered 1012, above 1007 and 1008 and the planned 1010 (T08b) and 1011 (T09), the next free number in F09's block.

create function app.record_booking_cancel(
  p_booking uuid, p_kind text, p_outcome text, p_returned jsonb, p_reason text, p_closure uuid default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_order uuid;
  v_version integer;
  v_returned jsonb := coalesce(p_returned, '{}'::jsonb);
  v_id uuid;
begin
  select order_id into v_order from public.booking where club_id = v_club and id = p_booking;
  if not found then
    raise exception 'cancel:not_found' using errcode = 'P0001';
  end if;
  select coalesce(max(c.version), 0) + 1 into v_version from public.booking_cancel c where c.club_id = v_club and c.booking_id = p_booking;
  insert into public.booking_cancel (club_id, booking_id, order_id, kind, outcome, version, returned, credit_lost, reason, by_user, closure_id)
  values (v_club, p_booking, v_order, p_kind, p_outcome, v_version, v_returned,
          coalesce((v_returned ->> 'creditLost')::integer, 0) > 0,
          case when p_kind = 'player_cancel' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
          app.user_id(), p_closure)
  returning id into v_id;
  return v_id;
end $$;
alter function app.record_booking_cancel(uuid, text, text, jsonb, text, uuid) owner to booq_owner;
revoke all on function app.record_booking_cancel(uuid, text, text, jsonb, text, uuid) from public;

create or replace function app.mark_record(b public.booking, p_kind text, p_outcome text, p_returned jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_version integer;
  v_id uuid;
begin
  v_id := app.record_booking_cancel(b.id, p_kind, p_outcome, p_returned, p_reason);
  select c.version into v_version from public.booking_cancel c where c.club_id = b.club_id and c.id = v_id;
  perform app.run_cancel_handlers(b.id, p_kind);
  return jsonb_build_object('bookingCancel', v_id, 'version', v_version, 'kind', p_kind, 'outcome', p_outcome);
end $$;

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

  return jsonb_build_object('bookingCancel', v_id, 'version', v_version, 'kind', v_kind, 'outcome', v_outcome ->> 'outcome',
                            'returned', v_returned, 'repeated', false);
end $$;
alter function app.cancel_booking(uuid, boolean, boolean, text, uuid) owner to booq_owner;
revoke all on function app.cancel_booking(uuid, boolean, boolean, text, uuid) from public;
grant execute on function app.cancel_booking(uuid, boolean, boolean, text, uuid) to booq_app, booq_worker;
