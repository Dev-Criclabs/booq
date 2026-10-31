-- F12-T06 / migration 1206: the coach is told when a class is booked, moved or cancelled. F12 design 5.8. Requirements: CPORT-07, LINE-05;
-- decisions D91, D95; assumption A-6 (one message per group seat event).
-- F07 already sends `leave_decision` and, for a substitution, `session_change` to both coaches; F08 sends `session_change` when a session
-- is edited or cancelled. What was missing is the coach's message when a player or staff books, moves or cancels a class. Two triggers
-- (no function of F03, F05, F08 or F09 is redefined) call F10's app.enqueue_message with kind `session_change` and the parameter `change`
-- (`booked`, `moved`, `cancelled`) plus the booking or the session id; the wording and the language (the coach's, D95) are F10's.
--   * a solo class that becomes confirmed (inserted confirmed, or held then paid): `booked`; confirmed with a new start: `moved`; a confirmed
--     class that is cancelled or late cancelled: `cancelled`; all to booking.coach_id. A change of coach (a substitution, F07) is not
--     ours: F07 sends both coaches their own message. A coach added to an existing booking is told when the add order is confirmed
--     (the second trigger), not while it is only held for payment.
--   * a group seat that becomes confirmed: `booked`; a confirmed seat that is cancelled or late cancelled: `cancelled`, to the session's
--     coach, except when the whole session was cancelled (F08 sends the coach one message for that).
-- Dedupe key `coach_booking:{booking}:{change}:{start epoch}`, so a retry or a second update with the same values sends nothing more.
-- A released hold never confirmed sends nothing. With no club in the context nothing is enqueued and the booking goes on.

create function app.f12_notify_coach() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_change text;
  v_coach uuid;
  v_params jsonb;
  s public.class_session%rowtype;
begin
  if app.club_id() is null then
    return new;
  end if;
  if new.type = 'solo_class' and new.coach_id is not null then
    if tg_op = 'UPDATE' and old.coach_id is distinct from new.coach_id then
      return new;                                   -- a coach added or substituted: not ours (see above)
    end if;
    if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
      v_change := 'booked';
    elsif tg_op = 'UPDATE' and new.status = 'confirmed' and old.status = 'confirmed' and old.start_at <> new.start_at then
      v_change := 'moved';
    elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status in ('cancelled', 'late_cancelled') then
      v_change := 'cancelled';
    end if;
    v_coach := new.coach_id;
    v_params := jsonb_build_object('booking_id', new.id);
  elsif new.type = 'class_seat' and new.class_session_id is not null then
    select * into s from public.class_session c where c.club_id = new.club_id and c.id = new.class_session_id;
    if not found then
      return new;
    end if;
    if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
      v_change := 'booked';
    elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status in ('cancelled', 'late_cancelled') and s.status <> 'cancelled' then
      v_change := 'cancelled';
    end if;
    v_coach := s.coach_id;
    v_params := jsonb_build_object('booking_id', new.id, 'session_id', s.id);
  end if;
  if v_change is null or v_coach is null then
    return new;
  end if;
  perform app.enqueue_message('session_change', v_coach, v_params || jsonb_build_object('change', v_change),
                              'coach_booking:' || new.id::text || ':' || v_change || ':' || extract(epoch from new.start_at)::bigint::text, app.now());
  return new;
end $$;
alter function app.f12_notify_coach() owner to booq_owner;
revoke all on function app.f12_notify_coach() from public;
create trigger f12_notify_coach after insert or update on public.booking for each row execute function app.f12_notify_coach();

-- A coach added to an existing booking is told once the add order is confirmed.
create function app.f12_notify_coach_add() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_start timestamptz;
begin
  if app.club_id() is null or new.status <> 'confirmed' or (tg_op = 'UPDATE' and old.status = 'confirmed') then
    return new;
  end if;
  select b.start_at into v_start from public.booking b where b.club_id = new.club_id and b.id = new.booking_id;
  perform app.enqueue_message('session_change', new.coach_id, jsonb_build_object('booking_id', new.booking_id, 'change', 'booked'),
                              'coach_booking:' || new.booking_id::text || ':booked:' || extract(epoch from v_start)::bigint::text, app.now());
  return new;
end $$;
alter function app.f12_notify_coach_add() owner to booq_owner;
revoke all on function app.f12_notify_coach_add() from public;
create trigger f12_notify_coach_add after insert or update on public.booking_coach_add for each row execute function app.f12_notify_coach_add();
