-- F01-T20 / migration 0032: the only writer of club.status.
-- F01 design 3.3 and 4.1; requirements PLAT-01-AC1 to AC4, AC7, AC8, AC10; review SR-02.
--
-- club.status has no UPDATE grant for any role (migration 0002), so a status change can only come
-- from these definer functions, owned by booq_owner:
--   app.apply_status_change(to, reason, via_pause)  internal, executable by nobody. The transition
--     table, the checks, the history row and the window clearing live here.
--   app.set_club_status(to, reason)                 for BOOQ staff (booq_platform). Draft to Testing
--     and Testing to Live only. Pause and resume are done by pause_club and resume_club (F01-T22),
--     which call apply_status_change with via_pause = true.
-- The club comes from app.club_id() and the actor from app.actor_platform_staff_id (set by
-- withPlatformTx), never from an argument. Backward moves and Delete are refused (D14, A-6).
-- Errors are raised as 'club_status:<code>' with SQLSTATE P0001; a refused Go live carries the list
-- of what is missing as JSON in DETAIL.

-- The functions run as booq_owner, which row security also binds (FORCE): it may change only the
-- caller's own club row and add history for it.
create policy club_owner_role_status on public.club for update to booq_owner
  using (id = app.club_id()) with check (id = app.club_id());
create policy club_status_change_owner_insert on public.club_status_change for insert to booq_owner
  with check (club_id = app.club_id());

-- What stops a move. Draft to Testing: setup steps 1 to 8 (the list and the check come with F01-T23,
-- which replaces this function; until then nothing blocks it). Testing to Live: at least one launch
-- check exists and every launch check is a pass (PLAT-01-AC3; the list of checks is data, design 9.3).
create function app.status_blockers(p_club uuid, p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  if p_from = 'testing' and p_to = 'live' then
    if not exists (select 1 from platform.launch_check c where c.club_id = p_club) then
      return jsonb_build_array(jsonb_build_object('item', 'no_launch_checks', 'result', 'missing'));
    end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object('item', c.check_key, 'result', c.result) order by c.check_key)
        from platform.launch_check c where c.club_id = p_club and c.result <> 'pass'
    ), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
alter function app.status_blockers(uuid, text, text) owner to booq_owner;
revoke all on function app.status_blockers(uuid, text, text) from public;

create function app.apply_status_change(p_to text, p_reason text, p_via_pause boolean) returns text
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_role text;
  v_from text;
  v_pause_move boolean;
  v_blockers jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_club is null then
    raise exception 'club_status:no_club_context' using errcode = 'P0001';
  end if;
  select s.role into v_role from platform.platform_staff s where s.id = v_staff and s.active;
  if v_role is null then
    raise exception 'club_status:actor_required' using errcode = 'P0001';
  end if;
  select c.status into v_from from public.club c where c.id = v_club for update;
  if v_from is null
     or (v_role <> 'platform_admin'
         and not exists (select 1 from platform.staff_assignment a where a.staff_id = v_staff and a.club_id = v_club)) then
    raise exception 'club_status:not_found' using errcode = 'P0001';    -- unassigned and missing look the same (404)
  end if;

  if (v_from, p_to) not in (('draft', 'testing'), ('testing', 'live'), ('live', 'paused'), ('paused', 'live')) then
    raise exception 'club_status:transition_not_allowed' using errcode = 'P0001';
  end if;
  v_pause_move := 'paused' in (v_from, p_to);
  if v_pause_move and not p_via_pause then
    raise exception 'club_status:use_pause' using errcode = 'P0001';
  end if;
  if v_pause_move then
    if v_role <> 'platform_admin' then
      raise exception 'club_status:admin_only' using errcode = 'P0001';
    end if;
    if v_reason is null then
      raise exception 'club_status:reason_required' using errcode = 'P0001';
    end if;
  end if;

  v_blockers := app.status_blockers(v_club, v_from, p_to);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'club_status:blocked' using errcode = 'P0001', detail = v_blockers::text;
  end if;

  -- Go live, pause and resume end any open owner window (SR-02). The audit trigger on club
  -- records this update with the staff member as actor.
  update public.club
     set status = p_to, allow_booq_changes_until = null, allow_booq_changes_set_at = null
   where id = v_club;
  insert into public.club_status_change (club_id, from_status, to_status, reason, actor_staff_id)
    values (v_club, v_from, p_to, coalesce(v_reason, v_from || '_to_' || p_to), v_staff);
  return p_to;
end $$;
alter function app.apply_status_change(text, text, boolean) owner to booq_owner;
revoke all on function app.apply_status_change(text, text, boolean) from public;

create function app.set_club_status(p_to text, p_reason text default null) returns text
language sql security definer set search_path = pg_catalog
as $$ select app.apply_status_change(p_to, p_reason, false) $$;
alter function app.set_club_status(text, text) owner to booq_owner;
revoke all on function app.set_club_status(text, text) from public;
grant execute on function app.set_club_status(text, text) to booq_platform;
