-- F01-T28 / migration 0040: testers, tester invites and the sign-in gate for F02.
-- Requirements: PLAT-07-AC5, AC6; PLAT-01-AC5, AC11; decisions D100, D102, D4; review SR-01.
--
--   * BOOQ staff create a tester invite (kind tester, the player role only, enforced by the CHECK in 0003):
--     long lived, not bound to a person, for a Draft or Testing club. The person who uses it signs in with
--     LINE as an ordinary player; no BOOQ credential is involved (ROLE-02-AC2).
--   * The platform sees the BOOQ testers masked: when they joined and their LINE name, nothing they did (AC6).
--   * Every change is written to P6: the invite, the join (a trigger on club_tester) and the removal.
--   * app.sign_in_gate is what F02's sign in asks before it creates a session: Live and Paused admit everyone;
--     a Draft or Testing club admits the owner role and listed testers on every visit, and a new person who
--     presents a valid owner or tester link; everyone else is "not a tester", shown as not found.

insert into platform.config (key, value) values ('tester_invite_ttl_hours', '720'::jsonb)   -- 30 days, a proposal: tester links are long lived (D102); an admin can change it
  on conflict (key) do nothing;

create function platform.create_tester_invite(p_club uuid, p_token_hash text) returns uuid
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

-- The platform's view of the testers: masked. Only BOOQ testers (the owner is not a tester here), their LINE
-- name and when they joined or were removed; never what they did. Null for a club the caller cannot see.
create function platform.club_testers(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  if not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    return null;
  end if;
  return jsonb_build_object(
    'testers', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'added_at', t.added_at, 'removed_at', t.removed_at, 'display_name', u.display_name) order by t.added_at, t.id)
        from public.club_tester t join public.app_user u on u.club_id = t.club_id and u.id = t.user_id
       where t.club_id = p_club and t.kind = 'boq_tester'
    ), '[]'::jsonb),
    'pending_invites', (select count(*)::int from public.club_invite i
                         where i.club_id = p_club and i.kind = 'tester' and i.used_at is null and i.expires_at > app.now())
  );
end $$;

create function platform.remove_tester(p_club uuid, p_tester uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) then
    raise exception 'tester:not_found' using errcode = 'P0001';
  end if;
  update public.club_tester set removed_at = app.now()
   where club_id = p_club and id = p_tester and kind = 'boq_tester' and removed_at is null;
  if not found then
    raise exception 'tester:not_found' using errcode = 'P0001';
  end if;
  perform platform.write_audit('club.tester_removed', p_club, 'club', p_club::text, '{}'::jsonb, null, null);
end $$;

-- A BOOQ tester who joins is a P6 fact (PLAT-07-AC5). No person is named in it.
create function app.log_tester_added() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if new.kind = 'boq_tester' then
    insert into platform.audit_log (action, club_id, target_type, target_id, detail)
      values ('club.tester_added', new.club_id, 'club_tester', new.id::text, '{}'::jsonb);
  end if;
  return null;
end $$;
alter function app.log_tester_added() owner to booq_owner;
revoke all on function app.log_tester_added() from public;
create trigger club_tester_log after insert on public.club_tester for each row execute function app.log_tester_added();

-- The status gate (F02 design 6.4). The club comes from the context; the LINE id is the one the caller verified.
-- Answers: open, club_not_available, account_inactive, not_a_tester.
create function app.sign_in_gate(p_line_user_id text, p_invite_hash text default null) returns text
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
  if v_status is null then return 'club_not_available'; end if;
  select u.id, u.active into v_user, v_active from public.app_user u where u.club_id = v_club and u.line_user_id = p_line_user_id;
  if v_user is not null and not v_active then return 'account_inactive'; end if;
  if v_status in ('live', 'paused') then return 'open'; end if;
  if v_status not in ('draft', 'testing') then return 'club_not_available'; end if;
  -- Draft and Testing: the owner role on every visit, then listed testers.
  if v_user is not null and (
       exists (select 1 from public.app_user_role r where r.club_id = v_club and r.user_id = v_user and r.role = 'owner')
       or exists (select 1 from public.club_tester t where t.club_id = v_club and t.user_id = v_user and t.removed_at is null)) then
    return 'open';
  end if;
  -- A person who presents a valid owner or tester link may come in to redeem it (single use, not expired, bound if bound).
  if p_invite_hash is not null and exists (
       select 1 from public.club_invite i
        where i.club_id = v_club and i.token_hash = p_invite_hash and i.kind in ('owner', 'tester')
          and i.used_at is null and i.expires_at > app.now()
          and (i.bound_line_user_id is null or i.bound_line_user_id = p_line_user_id)) then
    return 'open';
  end if;
  return 'not_a_tester';
end $$;

do $$
declare f text;
begin
  foreach f in array array['platform.create_tester_invite(uuid, text)', 'platform.club_testers(uuid)', 'platform.remove_tester(uuid, uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_platform', f);
  end loop;
  alter function app.sign_in_gate(text, text) owner to booq_owner;
  revoke all on function app.sign_in_gate(text, text) from public;
  grant execute on function app.sign_in_gate(text, text) to booq_app;
end $$;
