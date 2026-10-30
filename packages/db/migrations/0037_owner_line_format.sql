-- F01-T23 follow-up / migration 0037: the owner LINE id has a format (orchestrator default for D122).
-- The invite is bound to the id BOOQ staff type in P2 step 1 and compared exactly with the verified LINE
-- user id at sign in, so a value that cannot be a LINE user id (U and 32 hex characters) could never be
-- redeemed. It is refused in the table and in platform.change_owner_contact. How staff learn the id before
-- the owner has ever signed in is an open spec question; nothing here invents a discovery flow.

alter table public.club add constraint club_owner_line_format check (owner_line is null or owner_line ~ '^U[0-9a-f]{32}$');

create or replace function platform.change_owner_contact(p_club uuid, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  k text;
  v_id uuid;
  v_fields jsonb;
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    raise exception 'owner_invite:not_found' using errcode = 'P0001';
  end if;
  if app.club_id() is distinct from p_club then
    raise exception 'owner_invite:club_context' using errcode = 'P0001';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'owner_invite:invalid_field' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('owner_name', 'owner_phone', 'owner_line', 'owner_email')
       or jsonb_typeof(p_changes -> k) <> 'string' or btrim(p_changes ->> k) = ''
       or (k = 'owner_line' and (p_changes ->> k) !~ '^U[0-9a-f]{32}$') then
      raise exception 'owner_invite:invalid_field' using errcode = 'P0001';
    end if;
  end loop;
  if not platform.club_editable(p_club) then
    raise exception 'owner_invite:look_only' using errcode = 'P0001';
  end if;
  v_fields := (select jsonb_agg(f order by f) from jsonb_object_keys(p_changes) f);
  if not exists (select 1 from public.club_invite i where i.club_id = p_club and i.kind = 'owner') then
    perform platform.apply_owner_contact(p_club, p_changes);
    perform platform.write_audit('club.owner_contact_changed', p_club, 'club', p_club::text, jsonb_build_object('fields', v_fields), null, null);
    return jsonb_build_object('applied', true);
  end if;
  insert into platform.owner_contact_change (club_id, requested_by, changes) values (p_club, v_staff, p_changes) returning id into v_id;
  perform platform.write_audit('club.owner_contact_requested', p_club, 'club', p_club::text, jsonb_build_object('fields', v_fields), null, null);
  return jsonb_build_object('applied', false, 'request_id', v_id);
end $$;
