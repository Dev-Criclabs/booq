-- F08-T13 / migration 0917: app.resolve_session, the owner's retry of a session that needs attention (CLASS-01-AC9). F08 design 4.3.
-- A needs_attention session has no occupancy row because its court or coach could not be claimed (or the coach did not work that hour).
-- Once the owner has fixed the cause (a leave declined, a court freed, availability added) this tries again: the same checks as the
-- template (app.class_hour_problem, ignoring this template's own sessions), and when the hour is clear the session becomes scheduled and
-- claims court and coach in one occupancy row. When it is still blocked it stays needs_attention and its reason is brought up to date.
-- Returns {resolved, reason}. Owner only. Lock order of FA 3.4: the coach, the session row, then the court lock before the write.
create function app.resolve_session(p_session uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s public.class_session%rowtype;
  v_problem text;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner') then
    raise exception 'session: not allowed' using errcode = '42501';
  end if;
  select * into s from public.class_session where club_id = v_club and id = p_session;
  if not found then perform app.refuse('session_not_available'); end if;
  perform app.lock_coach(s.coach_id);
  select * into s from public.class_session where club_id = v_club and id = p_session for update;
  if s.status = 'scheduled' then return jsonb_build_object('resolved', true, 'reason', null); end if;
  if s.status <> 'needs_attention' then perform app.refuse('session_not_available'); end if;
  if s.start_at <= app.now() then perform app.refuse('hour_started'); end if;
  v_problem := app.class_hour_problem(s.coach_id, s.resource_id, s.start_at, s.template_id);
  if v_problem is not null then
    update public.class_session set attention_reason = v_problem where club_id = v_club and id = p_session;
    return jsonb_build_object('resolved', false, 'reason', v_problem);
  end if;
  begin
    perform app.lock_resource(s.resource_id);                  -- step 3c, last before the occupancy write
    insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id)
    values (v_club, 'group_class', s.resource_id, s.coach_id, s.start_at, s.end_at, 'confirmed', p_session);
  exception when exclusion_violation then
    update public.class_session set attention_reason = 'court_clash' where club_id = v_club and id = p_session;
    return jsonb_build_object('resolved', false, 'reason', 'court_clash');
  end;
  update public.class_session set status = 'scheduled', attention_reason = null where club_id = v_club and id = p_session;
  return jsonb_build_object('resolved', true, 'reason', null);
end $$;
alter function app.resolve_session(uuid) owner to booq_owner;
revoke all on function app.resolve_session(uuid) from public;
grant execute on function app.resolve_session(uuid) to booq_app;
