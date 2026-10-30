-- F02-T02 / migration 0102: server sessions. F02 design 7.2. Requirements: LINE-01-AC13, AUTH-02-AC3.
-- Only the hash of the session cookie is stored, never the token (the CHECK accepts nothing but a
-- sha-256 hex string). A pending sign-up holds the LINE id and the display name for its short
-- life and nothing else. The lifetimes are platform config values with no code default, so the
-- caller passes the expiry. Class D. The app roles have no table privilege: every path is a
-- function, and each takes the club from the context (SR-07).

create table public.auth_session (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  token_hash text not null,
  user_id uuid,
  line_user_id text not null check (line_user_id <> ''),
  pending_display_name text,
  pending_language text,
  state text not null,
  created_at timestamptz not null default app.now(),
  last_seen_at timestamptz not null default app.now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  constraint auth_session_token_unique unique (token_hash),
  constraint auth_session_token_is_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint auth_session_state_values check (state in ('pending_profile', 'active', 'revoked')),
  constraint auth_session_user_matches_state check ((state = 'active') = (user_id is not null) or state = 'revoked'),
  constraint auth_session_pending_language check (pending_language is null or pending_language in ('th', 'en')),
  constraint auth_session_revoked_has_time check ((state = 'revoked') = (revoked_at is not null)),
  constraint auth_session_expiry check (expires_at > created_at)
);
create index auth_session_user on public.auth_session (club_id, user_id) where user_id is not null;
create index auth_session_expiry_idx on public.auth_session (club_id, expires_at);

alter table public.auth_session owner to booq_owner;
alter table public.auth_session enable row level security;
alter table public.auth_session force row level security;
revoke all on public.auth_session from public;
create policy auth_session_tenant on public.auth_session as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy auth_session_definer on public.auth_session for all to booq_owner using (true) with check (true);

-- A session of a test account is test data and follows the person (D100); a pending session has no person.
select app.register_test_table('public.auth_session', 850, false);
create trigger is_test_copy before insert on public.auth_session for each row execute function app.copy_user_is_test();

-- Create: a pending sign-up (no person yet) or an active session. The caller has just verified the
-- LINE token; it passes the hash of the cookie it will set.
create function app.create_session(p_token_hash text, p_state text, p_user uuid, p_line_user_id text,
                                   p_display_name text, p_language text, p_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_id uuid;
begin
  if v_club is null then
    raise exception 'create_session needs a club in the context' using errcode = 'P0001';
  end if;
  if p_state not in ('pending_profile', 'active') then
    raise exception 'create_session: state must be pending_profile or active' using errcode = 'P0001';
  end if;
  if p_expires_at is null or p_expires_at <= app.now() then
    raise exception 'create_session: expires_at must be in the future' using errcode = 'P0001';
  end if;
  if p_state = 'active' and not exists (
       select 1 from public.app_user u where u.club_id = v_club and u.id = p_user and u.line_user_id = p_line_user_id and u.active) then
    raise exception 'create_session: no active person with that LINE id in this club' using errcode = 'P0001';
  end if;
  insert into public.auth_session (club_id, token_hash, user_id, line_user_id, pending_display_name, pending_language, state, expires_at)
  values (v_club, p_token_hash, case when p_state = 'active' then p_user end, p_line_user_id,
          case when p_state = 'pending_profile' then p_display_name end,
          case when p_state = 'pending_profile' then p_language end, p_state, p_expires_at)
  returning id into v_id;
  return v_id;
end $$;

-- Look a session up by the hash of the cookie and mark it seen. Revoked, expired, of another club,
-- or of a deactivated person: no row. "Refused at once" is this check on every request.
create function app.touch_session(p_token_hash text)
returns table (session_id uuid, state text, user_id uuid, line_user_id text, pending_display_name text, pending_language text, expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s public.auth_session%rowtype;
begin
  if v_club is null then
    raise exception 'touch_session needs a club in the context' using errcode = 'P0001';
  end if;
  update public.auth_session a
     set last_seen_at = app.now()
   where a.club_id = v_club and a.token_hash = p_token_hash and a.state <> 'revoked' and a.expires_at > app.now()
     and (a.user_id is null or exists (select 1 from public.app_user u where u.club_id = a.club_id and u.id = a.user_id and u.active))
  returning a.* into s;
  if not found then
    return;
  end if;
  session_id := s.id; state := s.state; user_id := s.user_id; line_user_id := s.line_user_id;
  pending_display_name := s.pending_display_name; pending_language := s.pending_language; expires_at := s.expires_at;
  return next;
end $$;

-- Sign out, or a pending sign-up that became a person: the session ends now.
create function app.revoke_session(p_token_hash text) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_n integer;
begin
  if v_club is null then
    raise exception 'revoke_session needs a club in the context' using errcode = 'P0001';
  end if;
  update public.auth_session set state = 'revoked', revoked_at = app.now()
   where club_id = v_club and token_hash = p_token_hash and state <> 'revoked';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- A person who is deactivated loses every session in the same transaction (ROLE-02, F01 6.1).
create function app.revoke_sessions_of_deactivated() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  update public.auth_session set state = 'revoked', revoked_at = app.now()
   where club_id = new.club_id and user_id = new.id and state <> 'revoked';
  return null;
end $$;
create trigger app_user_revoke_sessions after update of active on public.app_user
  for each row when (old.active and not new.active) execute function app.revoke_sessions_of_deactivated();

-- Housekeeping, per club in the club's context: expired sessions and sign-ups are removed.
create function app.purge_expired_sessions() returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_n integer;
begin
  if v_club is null then
    raise exception 'purge_expired_sessions needs a club in the context' using errcode = 'P0001';
  end if;
  delete from public.auth_session where club_id = v_club and expires_at <= app.now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.create_session(text, text, uuid, text, text, text, timestamptz)', 'app.touch_session(text)', 'app.revoke_session(text)',
    'app.revoke_sessions_of_deactivated()', 'app.purge_expired_sessions()'
  ] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
grant execute on function app.create_session(text, text, uuid, text, text, text, timestamptz) to booq_app;
grant execute on function app.touch_session(text) to booq_app;
grant execute on function app.revoke_session(text) to booq_app;
grant execute on function app.purge_expired_sessions() to booq_worker;
