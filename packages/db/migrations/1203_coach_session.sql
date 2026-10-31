-- F12-T03 / migration 1203: K5 Session detail. F12 design 5.5. Requirements: CPORT-05; CC-1, CC-2, CC-3.
--   app.coach_session(kind, id) returns jsonb: the header, the roster of live confirmed players with the coach's mark and notes, the
--   session note, whether marking is open, and the counts. kind `solo` is a solo class booking, `group` a class session; the
--   session must be the signed-in coach's, else portal:not_found (404; the coach is never an input).
-- A player is shown by the name they gave and their level, with this coach's own notes only: the note on this session, and the most
-- recent earlier note on that player from another session. A seat still held for payment counts in `players` but is not listed.
-- `can_mark` is the reason marking is open or closed: `ok`, `not_ended` (the hour has not ended) or `month_paid` (the coach's payout
-- for that Bangkok month is marked paid, F13), shared with app.mark_attendance (1204) through app.portal_mark_state.
-- Errors: portal:forbidden, portal:not_found, portal:invalid_kind.

create function app.portal_mark_state(p_coach uuid, p_start timestamptz, p_end timestamptz) returns text
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  if p_end > app.now() then
    return 'not_ended';
  end if;
  if exists (select 1 from public.coach_payout p
              where p.club_id = app.club_id() and p.coach_id = p_coach and p.status = 'paid'
                and p.month = date_trunc('month', p_start at time zone 'Asia/Bangkok')::date) then
    return 'month_paid';
  end if;
  return 'ok';
end $$;
alter function app.portal_mark_state(uuid, timestamptz, timestamptz) owner to booq_owner;
revoke all on function app.portal_mark_state(uuid, timestamptz, timestamptz) from public;

create function app.coach_session(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_me uuid := app.portal_coach();
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  s public.class_session%rowtype;
  v_header jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_roster jsonb;
  v_note text;
  v_players integer;
  v_capacity integer;
begin
  if p_kind = 'solo' then
    select * into b from public.booking k
     where k.club_id = v_club and k.id = p_id and k.type = 'solo_class' and k.coach_id = v_me and k.status in ('confirmed', 'awaiting_payment', 'no_show');
    if not found then
      raise exception 'portal:not_found' using errcode = 'P0001';
    end if;
    v_start := b.start_at;
    v_end := b.end_at;
    v_header := jsonb_build_object('kind', 'solo', 'id', b.id, 'start_at', b.start_at, 'end_at', b.end_at, 'status', b.status, 'held', b.status = 'awaiting_payment',
      'court', (select r.name from public.resource r where r.club_id = v_club and r.id = b.resource_id));
    v_players := 1;
    v_roster := coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_id', b.id, 'customer_id', u.id, 'name', coalesce(u.full_name, u.display_name), 'level', u.level, 'mark', a.mark,
        'note', (select n.body from public.coach_note n where n.club_id = v_club and n.coach_id = v_me and n.booking_id = b.id and n.customer_id = u.id),
        'last_note', (select jsonb_build_object('body', n.body, 'at', n.updated_at) from public.coach_note n
                       where n.club_id = v_club and n.coach_id = v_me and n.customer_id = u.id and n.booking_id is distinct from b.id
                       order by n.updated_at desc, n.id limit 1)))
        from public.app_user u
        left join public.coach_attendance a on a.club_id = v_club and a.booking_id = b.id
       where u.club_id = v_club and u.id = b.customer_id and b.status <> 'awaiting_payment'), '[]'::jsonb);
    select n.body into v_note from public.coach_note n where n.club_id = v_club and n.coach_id = v_me and n.booking_id = b.id and n.customer_id is null;
  elsif p_kind = 'group' then
    select * into s from public.class_session c
     where c.club_id = v_club and c.id = p_id and c.coach_id = v_me and c.status in ('scheduled', 'needs_attention');
    if not found then
      raise exception 'portal:not_found' using errcode = 'P0001';
    end if;
    v_start := s.start_at;
    v_end := s.end_at;
    v_capacity := s.max_players;
    v_header := jsonb_build_object('kind', 'group', 'id', s.id, 'start_at', s.start_at, 'end_at', s.end_at, 'status', s.status, 'level', s.level,
      'class_name_th', s.name_th, 'class_name_en', s.name_en,
      'court', (select r.name from public.resource r where r.club_id = v_club and r.id = s.resource_id));
    select count(*)::integer into v_players from public.booking k
     where k.club_id = v_club and k.class_session_id = s.id and k.status in ('confirmed', 'awaiting_payment');
    v_roster := coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_id', k.id, 'customer_id', u.id, 'name', coalesce(u.full_name, u.display_name), 'level', u.level, 'mark', a.mark,
        'note', (select n.body from public.coach_note n where n.club_id = v_club and n.coach_id = v_me and n.class_session_id = s.id and n.customer_id = u.id),
        'last_note', (select jsonb_build_object('body', n.body, 'at', n.updated_at) from public.coach_note n
                       where n.club_id = v_club and n.coach_id = v_me and n.customer_id = u.id and n.class_session_id is distinct from s.id
                       order by n.updated_at desc, n.id limit 1))
        order by coalesce(u.full_name, u.display_name), k.id)
        from public.booking k
        join public.app_user u on u.club_id = k.club_id and u.id = k.customer_id
        left join public.coach_attendance a on a.club_id = k.club_id and a.booking_id = k.id
       where k.club_id = v_club and k.class_session_id = s.id and k.status = 'confirmed'), '[]'::jsonb);
    select n.body into v_note from public.coach_note n where n.club_id = v_club and n.coach_id = v_me and n.class_session_id = s.id and n.customer_id is null;
  else
    raise exception 'portal:invalid_kind' using errcode = 'P0001';
  end if;
  return v_header || jsonb_build_object(
    'players', v_players, 'capacity', v_capacity, 'roster', v_roster, 'session_note', v_note,
    'marked', (select count(*) from jsonb_array_elements(v_roster) e where e ->> 'mark' is not null),
    'listed', jsonb_array_length(v_roster),
    'can_mark', app.portal_mark_state(v_me, v_start, v_end));
end $$;
alter function app.coach_session(text, uuid) owner to booq_owner;
revoke all on function app.coach_session(text, uuid) from public;
grant execute on function app.coach_session(text, uuid) to booq_app;
