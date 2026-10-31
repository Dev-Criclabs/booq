-- F12-T04 / migration 1204: the coach marks attendance and writes private notes (K5). F12 design 5.6. Requirements: CPORT-05, D118, PLAT-04.
--   app.mark_attendance(booking, mark)                         `present` or `absent`, for one player of the coach's own session
--   app.save_session_note(kind, id, customer, body)            the session note (customer null) or a note on one player; a blank body deletes
-- The coach is the signed-in person. A mark needs the hour to have ended (portal:not_ended) and the coach's payout for that Bangkok month
-- not to be paid (portal:month_paid, F13; assumption A-1: no invented number of days). Marking a second time with the same value changes
-- nothing; a different value changes it (audited). A mark is a hint for staff (D118): it never touches the booking's status, a forfeit or
-- the payout. A note may be written once the session has started, by the session's coach, about a player who has a confirmed place in it;
-- it is replaced in place (the audit log keeps the old text in its pii columns) and is 2000 characters at most.
-- Errors: portal:forbidden, not_found, invalid_mark, invalid_kind, not_ended, month_paid, not_started, invalid_customer, body_too_long.

create function app.mark_attendance(p_booking uuid, p_mark text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  v_state text;
  a public.coach_attendance%rowtype;
begin
  select * into b from public.booking k where k.club_id = v_club and k.id = p_booking;
  if not found
     or not (
       (b.type = 'solo_class' and b.coach_id = v_me and b.status in ('confirmed', 'no_show'))
       or (b.type = 'class_seat' and b.status in ('confirmed', 'no_show')
           and exists (select 1 from public.class_session s where s.club_id = b.club_id and s.id = b.class_session_id and s.coach_id = v_me
                          and s.status in ('scheduled', 'needs_attention')))) then
    raise exception 'portal:not_found' using errcode = 'P0001';
  end if;
  if p_mark is null or p_mark not in ('present', 'absent') then
    raise exception 'portal:invalid_mark' using errcode = 'P0001';
  end if;
  v_state := app.portal_mark_state(v_me, b.start_at, b.end_at);
  if v_state <> 'ok' then
    raise exception 'portal:%', v_state using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_attendance:' || p_booking::text, 0));
  select * into a from public.coach_attendance x where x.club_id = v_club and x.booking_id = p_booking;
  if not found then
    insert into public.coach_attendance (club_id, booking_id, coach_id, mark) values (v_club, p_booking, v_me, p_mark);
    return jsonb_build_object('booking_id', p_booking, 'mark', p_mark, 'changed', true);
  end if;
  if a.mark = p_mark then
    return jsonb_build_object('booking_id', p_booking, 'mark', p_mark, 'changed', false);
  end if;
  update public.coach_attendance set mark = p_mark, changed_at = app.now() where club_id = v_club and booking_id = p_booking;
  return jsonb_build_object('booking_id', p_booking, 'mark', p_mark, 'changed', true);
end $$;
alter function app.mark_attendance(uuid, text) owner to booq_owner;
revoke all on function app.mark_attendance(uuid, text) from public;

create function app.save_session_note(p_kind text, p_id uuid, p_customer uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  s public.class_session%rowtype;
  v_start timestamptz;
  v_booking uuid;
  v_session uuid;
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if p_kind = 'solo' then
    select * into b from public.booking k where k.club_id = v_club and k.id = p_id and k.type = 'solo_class' and k.coach_id = v_me and k.status in ('confirmed', 'no_show');
    if not found then
      raise exception 'portal:not_found' using errcode = 'P0001';
    end if;
    v_start := b.start_at;
    v_booking := b.id;
    if p_customer is not null and p_customer <> b.customer_id then
      raise exception 'portal:invalid_customer' using errcode = 'P0001';
    end if;
  elsif p_kind = 'group' then
    select * into s from public.class_session c where c.club_id = v_club and c.id = p_id and c.coach_id = v_me and c.status in ('scheduled', 'needs_attention');
    if not found then
      raise exception 'portal:not_found' using errcode = 'P0001';
    end if;
    v_start := s.start_at;
    v_session := s.id;
    if p_customer is not null and not exists (select 1 from public.booking k where k.club_id = v_club and k.class_session_id = s.id and k.customer_id = p_customer and k.status in ('confirmed', 'no_show')) then
      raise exception 'portal:invalid_customer' using errcode = 'P0001';
    end if;
  else
    raise exception 'portal:invalid_kind' using errcode = 'P0001';
  end if;
  if v_start > app.now() then
    raise exception 'portal:not_started' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'portal:body_too_long' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_note:' || v_me::text || p_id::text || coalesce(p_customer::text, ''), 0));
  select n.id into v_id from public.coach_note n
   where n.club_id = v_club and n.coach_id = v_me and n.booking_id is not distinct from v_booking and n.class_session_id is not distinct from v_session
     and n.customer_id is not distinct from p_customer;
  if v_body = '' then
    if v_id is not null then
      delete from public.coach_note where club_id = v_club and id = v_id;
    end if;
    return jsonb_build_object('deleted', v_id is not null);
  end if;
  if v_id is null then
    insert into public.coach_note (club_id, coach_id, booking_id, class_session_id, customer_id, body) values (v_club, v_me, v_booking, v_session, p_customer, v_body);
  else
    update public.coach_note set body = v_body, updated_at = app.now() where club_id = v_club and id = v_id and body <> v_body;
  end if;
  return jsonb_build_object('saved', true);
end $$;
alter function app.save_session_note(text, uuid, uuid, text) owner to booq_owner;
revoke all on function app.save_session_note(text, uuid, uuid, text) from public;

grant execute on function app.mark_attendance(uuid, text), app.save_session_note(text, uuid, uuid, text) to booq_app;
