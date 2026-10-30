-- F01-T14 / migration 0050: roles and staff for the owner (ROLE-01-AC1, AC5, AC6, AC7; design 5.1 and 6.2).
-- Every function checks the owner role from the context (app.has_any_role), takes the club from the context and never
-- from an argument, and runs as the table owner so the policies of 0003 (which let a person update only themselves)
-- stay as they are. Errors are `staff:<code>` (P0001); a person who is not in this club answers not_found.
--   * app.set_user_roles(user, roles): the whole set of staff roles for a person; the old and new set go to the club audit log.
--     Roles are player, coach, front_desk, accountant and always include player (D115). The owner role is not assignable
--     here, and an owner's roles are not changed here (a default, D147; ownership changes need their own rule).
--   * app.create_staff_invite(kind, roles, token_hash): staff or coach invites only (BOOQ staff cannot make them, 0003).
--     The invite life is platform config `staff_invite_ttl_hours`, set by a BOOQ admin; none is shipped (no invented setting).
--   * app.list_staff() and app.list_staff_invites(): the owner's view, with no token hash.
--   * app.deactivate_user(user): inactive, their login sessions revoked, a note in the club audit log.

create function app.staff_owner_only() returns uuid
language plpgsql stable set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or not app.has_any_role('owner') then
    raise exception 'staff:forbidden' using errcode = 'P0001';
  end if;
  return app.club_id();
end $$;

create function app.set_user_roles(p_user uuid, p_roles text[]) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.staff_owner_only();
  v_old text[];
  v_new text[];
begin
  if p_roles is null or cardinality(p_roles) = 0
     or exists (select 1 from unnest(p_roles) r where r is null or r not in ('player', 'coach', 'front_desk', 'accountant'))
     or not ('player' = any (p_roles))
     or (select count(distinct r) from unnest(p_roles) r) <> cardinality(p_roles) then
    raise exception 'staff:invalid_roles' using errcode = 'P0001';
  end if;
  perform 1 from public.app_user u where u.club_id = v_club and u.id = p_user and u.active;
  if not found then
    raise exception 'staff:not_found' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(r.role order by r.role), array[]::text[]) into v_old
    from public.app_user_role r where r.club_id = v_club and r.user_id = p_user;
  if 'owner' = any (v_old) then
    raise exception 'staff:owner_fixed' using errcode = 'P0001';
  end if;
  select array_agg(r order by r) into v_new from unnest(p_roles) r;
  if v_new = v_old then
    return jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new), 'changed', false);
  end if;
  delete from public.app_user_role r where r.club_id = v_club and r.user_id = p_user and not (r.role = any (v_new));
  insert into public.app_user_role (club_id, user_id, role)
    select v_club, p_user, n from unnest(v_new) n
     where not exists (select 1 from public.app_user_role r where r.club_id = v_club and r.user_id = p_user and r.role = n);
  perform audit.note('roles.changed', 'app_user', p_user, jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new)));
  return jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new), 'changed', true);
end $$;

create function app.create_staff_invite(p_kind text, p_roles text[], p_token_hash text) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.staff_owner_only();
  v_roles text[];
  v_ttl numeric;
  v_id uuid;
begin
  if p_kind not in ('staff', 'coach') or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'staff:invalid_invite' using errcode = 'P0001';
  end if;
  if p_kind = 'coach' then
    v_roles := array['coach', 'player'];
  else
    if p_roles is null or cardinality(p_roles) = 0
       or exists (select 1 from unnest(p_roles) r where r is null or r not in ('front_desk', 'accountant')) then
      raise exception 'staff:invalid_invite' using errcode = 'P0001';
    end if;
    select array_agg(distinct r order by r) || array['player'] into v_roles from unnest(p_roles) r;
  end if;
  select (c.value #>> '{}')::numeric into v_ttl from platform.config c
   where c.key = 'staff_invite_ttl_hours' and jsonb_typeof(c.value) = 'number';
  if v_ttl is null or v_ttl <= 0 then
    raise exception 'staff:not_configured' using errcode = 'P0001';
  end if;
  insert into public.club_invite (club_id, token_hash, kind, roles, created_by_user, expires_at)
    values (v_club, p_token_hash, p_kind, v_roles, app.user_id(), app.now() + make_interval(secs => v_ttl * 3600))
    returning id into v_id;
  return v_id;
end $$;

create function app.list_staff() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.staff_owner_only();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'display_name', u.display_name, 'roles', to_jsonb(r.roles), 'active', u.active) order by u.created_at, u.id)
      from public.app_user u
      join lateral (select array_agg(x.role order by x.role) as roles from public.app_user_role x where x.club_id = u.club_id and x.user_id = u.id) r on true
     where u.club_id = v_club and r.roles && array['owner', 'front_desk', 'accountant', 'coach']
  ), '[]'::jsonb);
end $$;

create function app.list_staff_invites() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.staff_owner_only();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'roles', to_jsonb(i.roles), 'created_at', i.created_at, 'expires_at', i.expires_at) order by i.created_at, i.id)
      from public.club_invite i
     where i.club_id = v_club and i.kind in ('staff', 'coach') and i.used_at is null and i.expires_at > app.now()
  ), '[]'::jsonb);
end $$;

create function app.deactivate_user(p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.staff_owner_only();
begin
  if p_user = app.user_id() then
    raise exception 'staff:self' using errcode = 'P0001';
  end if;
  perform 1 from public.app_user u where u.club_id = v_club and u.id = p_user and u.active;
  if not found then
    raise exception 'staff:not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.app_user_role r where r.club_id = v_club and r.user_id = p_user and r.role = 'owner') then
    raise exception 'staff:owner_fixed' using errcode = 'P0001';
  end if;
  update public.app_user set active = false where club_id = v_club and id = p_user;
  update public.auth_session set revoked_at = app.now() where club_id = v_club and user_id = p_user and revoked_at is null;
  perform audit.note('user.deactivated', 'app_user', p_user, '{}'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.staff_owner_only()', 'app.set_user_roles(uuid, text[])', 'app.create_staff_invite(text, text[], text)',
                           'app.list_staff()', 'app.list_staff_invites()', 'app.deactivate_user(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
