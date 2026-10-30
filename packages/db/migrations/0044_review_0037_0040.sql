-- Migration 0044: review fixes for 0037-0040 (F01-T25, T28; PLAT-01-AC5, PLAT-07-AC5, AC6; ROLE-02-AC2).
--   * 0038: the owner reads the switches but cannot write them. BOOQ staff set them (0008 path, Testing only
--     unless in a support window).
--   * 0040: no invented link life (CLAUDE.md): nothing is seeded for tester_invite_ttl_hours, an admin sets it.
--     Creating or removing a tester needs the club to be editable by the caller (platform.club_editable).
--     The gate checks the club's status before the account state, so a Draft or Testing club shows an inactive
--     stranger as "not a tester", not as a known account.

drop policy club_feature_owner on public.club_feature;
revoke insert, update, delete on public.club_feature from booq_app;

delete from platform.config where key = 'tester_invite_ttl_hours';
grant insert on platform.config to booq_platform;
create policy config_admin_insert on platform.config for insert to booq_platform with check (platform.is_admin());

create or replace function platform.create_tester_invite(p_club uuid, p_token_hash text) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_status text;
  v_ttl numeric;
  v_id uuid;
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) then
    raise exception 'tester:not_found' using errcode = 'P0001';
  end if;
  select c.status into v_status from public.club c where c.id = p_club;
  if v_status is null then
    raise exception 'tester:not_found' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'testing') then
    raise exception 'tester:not_a_start' using errcode = 'P0001';
  end if;
  if not platform.club_editable(p_club) then
    raise exception 'tester:look_only' using errcode = 'P0001';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'tester:token_hash must be the 64 character hex SHA-256 of the token' using errcode = 'P0001';
  end if;
  select (c.value #>> '{}')::numeric into v_ttl from platform.config c where c.key = 'tester_invite_ttl_hours';
  if v_ttl is null or v_ttl <= 0 then
    raise exception 'tester:ttl_not_configured' using errcode = 'P0001';
  end if;
  insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at)
    values (p_club, p_token_hash, 'tester', array['player'], null, v_staff, app.now() + make_interval(secs => v_ttl * 3600))
    returning id into v_id;
  perform platform.write_audit('club.tester_invite_created', p_club, 'club', p_club::text, '{}'::jsonb, null, null);
  return v_id;
end $$;

create or replace function platform.remove_tester(p_club uuid, p_tester uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) then
    raise exception 'tester:not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.club c where c.id = p_club) then
    raise exception 'tester:not_found' using errcode = 'P0001';
  end if;
  if not platform.club_editable(p_club) then
    raise exception 'tester:look_only' using errcode = 'P0001';
  end if;
  update public.club_tester set removed_at = app.now()
   where club_id = p_club and id = p_tester and kind = 'boq_tester' and removed_at is null;
  if not found then
    raise exception 'tester:not_found' using errcode = 'P0001';
  end if;
  perform platform.write_audit('club.tester_removed', p_club, 'club', p_club::text, '{}'::jsonb, null, null);
end $$;

create or replace function app.sign_in_gate(p_line_user_id text, p_invite_hash text default null) returns text
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_status text;
  v_user uuid;
  v_active boolean;
begin
  if v_club is null then return 'club_not_available'; end if;
  select c.status into v_status from public.club c where c.id = v_club;
  if v_status is null or v_status not in ('draft', 'testing', 'live', 'paused') then return 'club_not_available'; end if;
  select u.id, u.active into v_user, v_active from public.app_user u where u.club_id = v_club and u.line_user_id = p_line_user_id;
  if v_status in ('live', 'paused') then
    return case when v_user is not null and not v_active then 'account_inactive' else 'open' end;
  end if;
  -- Draft and Testing: an inactive account is not admitted, and is not told it exists.
  if v_user is not null and v_active and (
       exists (select 1 from public.app_user_role r where r.club_id = v_club and r.user_id = v_user and r.role = 'owner')
       or exists (select 1 from public.club_tester t where t.club_id = v_club and t.user_id = v_user and t.removed_at is null)) then
    return 'open';
  end if;
  if (v_user is null or v_active) and p_invite_hash is not null and exists (
       select 1 from public.club_invite i
        where i.club_id = v_club and i.token_hash = p_invite_hash and i.kind in ('owner', 'tester')
          and i.used_at is null and i.expires_at > app.now()
          and (i.bound_line_user_id is null or i.bound_line_user_id = p_line_user_id)) then
    return 'open';
  end if;
  return 'not_a_tester';
end $$;
