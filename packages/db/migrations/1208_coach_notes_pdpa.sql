-- F12-T10 / migration 1208: the coach's notes and marks under the data request (PDPA-01, CPORT rules, D171). F12 design 10, 11 (Q-2).
-- A coach's note about a player is personal data about that player that the club holds. D171: it is part of the player's data export (the
-- right of access) and it is deleted when the player is anonymised. No screen and no route of the player app ever returns it.
--   app.f12_export(user)              the notes about the player (session date, kind, text, when written) and the Present or Absent marks
--                                     of their bookings (session date, kind, mark), as jsonb for the copy request; owner and front desk only
--                                     (the staff who handle a data request). It gives no coach id or name, no note about anyone else and
--                                     no general note on a session.
--   app.f12_deletion_impact(club, user)   the counts staff see before they confirm a deletion: coach_notes_about and coach_marks_of
--   app.f12_anonymise(club, user)         the notes about the player are deleted and the audit copies of their text are erased
--                                         (audit.erase_pii, like the staff notes); the marks stay as a fact of the booking, with no text and
--                                         no name. A coach's own notes and marks stay as records when the coach is anonymised (F07 A-8).
-- The handlers are registered with F01's tables (0019), like F07's.

create function app.f12_export(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null then
    raise exception 'f12_export needs a club in the context' using errcode = 'P0001';
  end if;
  if not app.has_any_role('owner', 'front_desk') then
    raise exception 'f12_export: not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', to_char(coalesce(b.start_at, s.start_at) at time zone 'Asia/Bangkok', 'YYYY-MM-DD'),
               'kind', case when n.booking_id is not null then 'solo' else 'group' end,
               'note', n.body,
               'written_at', to_char(n.updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS'))
             order by coalesce(b.start_at, s.start_at), n.id)
        from public.coach_note n
        left join public.booking b on b.club_id = n.club_id and b.id = n.booking_id
        left join public.class_session s on s.club_id = n.club_id and s.id = n.class_session_id
       where n.club_id = v_club and n.customer_id = p_user), '[]'::jsonb),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', to_char(b.start_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD'),
               'kind', case when b.type = 'solo_class' then 'solo' else 'group' end,
               'mark', a.mark)
             order by b.start_at, b.id)
        from public.coach_attendance a
        join public.booking b on b.club_id = a.club_id and b.id = a.booking_id
       where a.club_id = v_club and b.customer_id = p_user), '[]'::jsonb));
end $$;
alter function app.f12_export(uuid) owner to booq_owner;
revoke all on function app.f12_export(uuid) from public;
grant execute on function app.f12_export(uuid) to booq_app;

create function app.f12_deletion_impact(p_club uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'coach_notes_about', (select count(*) from public.coach_note n where n.club_id = p_club and n.customer_id = p_user),
    'coach_marks_of', (select count(*) from public.coach_attendance a join public.booking b on b.club_id = a.club_id and b.id = a.booking_id
                        where a.club_id = p_club and b.customer_id = p_user))
$$;

create function app.f12_anonymise(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_notes uuid[];
  v_note uuid;
begin
  -- The delete writes its own audit entry holding the text in pii_old, so erase after it, the way the staff notes are erased.
  with gone as (
    delete from public.coach_note where club_id = p_club and customer_id = p_user returning id
  )
  select coalesce(array_agg(id), '{}') into v_notes from gone;
  foreach v_note in array v_notes loop
    perform audit.erase_pii('coach_note', v_note);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.f12_deletion_impact(uuid, uuid)', 'app.f12_anonymise(uuid, uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
insert into app.deletion_impact_handlers (handler_key, handler) values ('f12_coach_notes', 'app.f12_deletion_impact(uuid, uuid)'::regprocedure);
insert into app.anonymise_handlers (handler_key, handler) values ('f12_coach_notes', 'app.f12_anonymise(uuid, uuid)'::regprocedure);
