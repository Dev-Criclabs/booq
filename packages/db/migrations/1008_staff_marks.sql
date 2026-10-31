-- F09-T07 / migration 1008: app.mark_no_show, app.mark_late_cancel, app.reverse_mark. F09 design 4.5.
-- Requirements: CANCEL-04-AC3 to AC12; decisions D28, D118, D158; assumptions A-5, A-6.
--
-- Front desk and owner only (mark:forbidden, AC10); a written reason always (mark:reason_required, AC3), which is set as
-- the request's reason so the audit entries and the forfeit row carry it. Locks in FA 3.4 order: the customer, the coach
-- of a solo class, the booking row. Errors are 'mark:<code>' or 'reverse:<code>' with SQLSTATE P0001.
--   * mark_no_show(booking, reason): a confirmed booking whose slot has ended (mark:not_ended before that, AC6; D118:
--     after the slot ends and nothing else, so no timing setting is read). Status no_show; the credit is forfeited with
--     the staff member and reason (return_booking_value, no_show_mark); a booking_cancel row no_show_mark, forfeited.
--     The slot has passed, so its occupancy row stays. The coach's Absent in K5 is a hint and never calls this (AC8).
--   * mark_late_cancel(booking, reason): a cancel made outside the app (AC4), on a confirmed booking whose slot has not
--     ended (mark:ended after that; staff use No show, A-5). Status late_cancelled; forfeited as a late cancel; when the
--     slot has not started its occupancy row is deleted and the reminders voided, so the hour is free again; the order
--     effects (1006) and a booking_cancel row late_cancel_mark, forfeited.
--   * reverse_mark(booking, reason): the latest booking_cancel row must be a no_show_mark or a late_cancel_mark
--     (reverse:not_marked). The forfeited credit comes back by a new return row (credit_reverse_forfeit, never an
--     edit, AC5, D28) and the status is confirmed again (which reads as Played once the slot has ended, D158). For a late
--     cancel whose row was deleted the hour is claimed again under the court lock and the exclusion constraints; when
--     the slot has ended or was taken meanwhile the reversal is refused (reverse:slot_unavailable) and staff correct
--     the value with an adjust (A-6). A cancelled order is paid again and the reminders queued again. A booking_cancel
--     row reversal, outcome returned. Coach pay follows its own rule and a paid referral reward stays (AC7).
-- Each runs app.run_cancel_handlers with its kind (F14 re-reads the referral status, AC11). Granted to booq_app (the
-- staff route); the function checks the role itself.

create function app.mark_lock(p_booking uuid, p_reason text) returns public.booking
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  v_coach uuid;
  b public.booking%rowtype;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'mark:forbidden' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'mark:reason_required' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', btrim(p_reason), true);
  select customer_id, coach_id into v_customer, v_coach from public.booking where club_id = v_club and id = p_booking;
  if not found then
    raise exception 'mark:not_found' using errcode = 'P0001';
  end if;
  if v_customer is not null then perform app.lock_customer(v_customer); end if;
  if v_coach is not null then perform app.lock_coach(v_coach); end if;
  select * into b from public.booking where club_id = v_club and id = p_booking for update;
  return b;
end $$;

create function app.mark_record(b public.booking, p_kind text, p_outcome text, p_returned jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_version integer;
  v_id uuid;
begin
  select coalesce(max(c.version), 0) + 1 into v_version from public.booking_cancel c where c.club_id = b.club_id and c.booking_id = b.id;
  insert into public.booking_cancel (club_id, booking_id, order_id, kind, outcome, version, returned, reason, by_user)
  values (b.club_id, b.id, b.order_id, p_kind, p_outcome, v_version, coalesce(p_returned, '{}'::jsonb), btrim(p_reason), app.user_id())
  returning id into v_id;
  perform app.run_cancel_handlers(b.id, p_kind);
  return jsonb_build_object('bookingCancel', v_id, 'version', v_version, 'kind', p_kind, 'outcome', p_outcome);
end $$;

create function app.mark_no_show(p_booking uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  b public.booking%rowtype;
  v_returned jsonb;
begin
  b := app.mark_lock(p_booking, p_reason);
  if b.status <> 'confirmed' then
    raise exception 'mark:not_confirmed' using errcode = 'P0001';
  end if;
  if b.end_at > app.now() then
    raise exception 'mark:not_ended' using errcode = 'P0001';
  end if;
  v_returned := app.return_booking_value(b.id, 'no_show_mark');
  update public.booking set status = 'no_show', updated_at = app.now() where club_id = b.club_id and id = b.id;
  return app.mark_record(b, 'no_show_mark', 'forfeited', v_returned, p_reason);
end $$;

create function app.mark_late_cancel(p_booking uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  b public.booking%rowtype;
  v_returned jsonb;
begin
  b := app.mark_lock(p_booking, p_reason);
  if b.status <> 'confirmed' then
    raise exception 'mark:not_confirmed' using errcode = 'P0001';
  end if;
  if b.end_at <= app.now() then
    raise exception 'mark:ended' using errcode = 'P0001';
  end if;
  v_returned := app.return_booking_value(b.id, 'late_cancel_mark');
  update public.booking set status = 'late_cancelled', updated_at = app.now() where club_id = b.club_id and id = b.id;
  if b.start_at > app.now() then
    delete from public.occupancy where club_id = b.club_id and booking_id = b.id;
    perform app.void_messages('reminder:' || b.id::text || ':', 'cancelled');
  end if;
  perform app.cancel_order_effects(b.id, 'late_cancel_mark');
  return app.mark_record(b, 'late_cancel_mark', 'forfeited', v_returned, p_reason);
end $$;

create function app.reverse_mark(p_booking uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  b public.booking%rowtype;
  v_last public.booking_cancel%rowtype;
  v_returned integer;
  v_constraint text;
begin
  b := app.mark_lock(p_booking, p_reason);
  select * into v_last from public.booking_cancel c where c.club_id = b.club_id and c.booking_id = b.id order by c.version desc limit 1;
  if not found or v_last.kind not in ('no_show_mark', 'late_cancel_mark') or b.status not in ('no_show', 'late_cancelled') then
    raise exception 'reverse:not_marked' using errcode = 'P0001';
  end if;

  if v_last.kind = 'late_cancel_mark' and not exists (select 1 from public.occupancy o where o.club_id = b.club_id and o.booking_id = b.id) then
    if b.end_at <= app.now() then
      raise exception 'reverse:slot_unavailable' using errcode = 'P0001';
    end if;
    perform app.lock_resource(b.resource_id);   -- the court lock, last, before the occupancy write (0229)
    begin
      insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id)
      values (b.club_id, case when b.coach_id is null then 'court_booking' else 'solo_class' end, b.resource_id, b.coach_id,
              b.start_at, b.end_at, 'confirmed', b.id);
    exception when exclusion_violation then
      raise exception 'reverse:slot_unavailable' using errcode = 'P0001';
    end;
  end if;

  v_returned := app.credit_reverse_forfeit(b.id, app.user_id(), btrim(p_reason));
  update public.booking set status = 'confirmed', updated_at = app.now() where club_id = b.club_id and id = b.id;
  update public.orders set status = 'paid' where club_id = b.club_id and id = b.order_id and status = 'cancelled';
  if b.start_at > app.now() then
    perform app.enqueue_booking_reminders(b.id);
  end if;
  return app.mark_record(b, 'reversal', 'returned', jsonb_build_object('credits', v_returned), p_reason);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.mark_lock(uuid, text)', 'app.mark_record(public.booking, text, text, jsonb, text)',
                           'app.mark_no_show(uuid, text)', 'app.mark_late_cancel(uuid, text)', 'app.reverse_mark(uuid, text)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
grant execute on function app.mark_no_show(uuid, text), app.mark_late_cancel(uuid, text), app.reverse_mark(uuid, text) to booq_app;
