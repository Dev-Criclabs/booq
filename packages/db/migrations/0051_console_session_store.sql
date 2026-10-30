-- Migration 0051: the console's shared session store (orchestrator-approved shape; platform transport).
-- The console is several short-lived processes, so its sessions, sign-in challenges and failed-code counts
-- cannot live in one process's memory. Three platform tables hold them. Nothing is granted on the tables:
-- the console reaches them only through the functions below (definer, platform schema, booq_platform only),
-- which is needed anyway because sign-in runs before any staff member is known. Ids are stored as a sha-256
-- hash, so reading the table never yields a usable cookie or challenge. Times are milliseconds since the
-- epoch at the interface, taken from the application clock; the tables hold timestamptz.

create table platform.console_session (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  staff_id uuid not null references platform.platform_staff (id),
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  step_up_at timestamptz not null
);
create index console_session_by_staff on platform.console_session (staff_id);

create table platform.console_challenge (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  staff_id uuid not null references platform.platform_staff (id),
  expires_at timestamptz not null,
  -- The identity provider's first-step token, kept server side under the opaque challenge id. The application seals it
  -- (AES-256-GCM) before it gets here, so the column never holds a usable token; it is never logged.
  provider_token_enc text check (provider_token_enc is null or provider_token_enc like 'v1.%')
);

create table platform.console_login_state (
  staff_id uuid primary key references platform.platform_staff (id),
  failures integer not null default 0 check (failures >= 0),
  locked_until timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['console_session', 'console_challenge', 'console_login_state'] loop
    execute format('alter table platform.%I owner to booq_owner', t);
    execute format('alter table platform.%I enable row level security', t);
    execute format('revoke all on platform.%I from public', t);
  end loop;
end $$;

create function platform.console_ms(p timestamptz) returns bigint
language sql immutable set search_path = pg_catalog
as $$ select round(extract(epoch from p) * 1000)::bigint $$;
create function platform.console_ts(p_ms bigint) returns timestamptz
language sql immutable set search_path = pg_catalog
as $$ select to_timestamp(p_ms / 1000.0) $$;

create function platform.console_session_put(p_id_hash text, p_staff uuid, p_created bigint, p_last_seen bigint, p_step_up bigint) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  insert into platform.console_session (id_hash, staff_id, created_at, last_seen_at, step_up_at)
    values (p_id_hash, p_staff, platform.console_ts(p_created), platform.console_ts(p_last_seen), platform.console_ts(p_step_up))
  on conflict (id_hash) do update set last_seen_at = excluded.last_seen_at, step_up_at = excluded.step_up_at
$$;

create function platform.console_session_get(p_id_hash text)
returns table (staff_id uuid, created_at bigint, last_seen_at bigint, step_up_at bigint)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select s.staff_id, platform.console_ms(s.created_at), platform.console_ms(s.last_seen_at), platform.console_ms(s.step_up_at)
    from platform.console_session s where s.id_hash = p_id_hash
$$;

create function platform.console_session_delete(p_id_hash text) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$ delete from platform.console_session where id_hash = p_id_hash $$;

create function platform.console_sessions_delete_for(p_staff uuid) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$ delete from platform.console_session where staff_id = p_staff $$;

create function platform.console_challenge_put(p_id_hash text, p_staff uuid, p_expires bigint, p_provider_token_enc text) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  insert into platform.console_challenge (id_hash, staff_id, expires_at, provider_token_enc)
    values (p_id_hash, p_staff, platform.console_ts(p_expires), p_provider_token_enc)
  on conflict (id_hash) do update set staff_id = excluded.staff_id, expires_at = excluded.expires_at, provider_token_enc = excluded.provider_token_enc
$$;

create function platform.console_challenge_get(p_id_hash text) returns table (staff_id uuid, expires_at bigint, provider_token_enc text)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select c.staff_id, platform.console_ms(c.expires_at), c.provider_token_enc from platform.console_challenge c where c.id_hash = p_id_hash $$;

create function platform.console_challenge_delete(p_id_hash text) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$ delete from platform.console_challenge where id_hash = p_id_hash $$;

-- The count goes up in one statement, so two wrong codes at the same moment are both counted.
create function platform.console_failure_add(p_staff uuid) returns integer
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  insert into platform.console_login_state as l (staff_id, failures) values (p_staff, 1)
  on conflict (staff_id) do update set failures = l.failures + 1
  returning l.failures
$$;

create function platform.console_failure_clear(p_staff uuid) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$ update platform.console_login_state set failures = 0 where staff_id = p_staff $$;

create function platform.console_lock_set(p_staff uuid, p_until bigint) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  insert into platform.console_login_state as l (staff_id, failures, locked_until) values (p_staff, 0, platform.console_ts(p_until))
  on conflict (staff_id) do update set locked_until = excluded.locked_until
$$;

create function platform.console_lock_get(p_staff uuid) returns bigint
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select platform.console_ms(l.locked_until) from platform.console_login_state l where l.staff_id = p_staff $$;

-- Housekeeping for the worker: challenges that expired, sessions older than the absolute limit (given in seconds
-- from platform config), and login states with nothing to remember. Reads and returns no club data.
create function app.sweep_console_sessions(p_absolute_seconds integer) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer := 0;
  v_k integer;
begin
  if p_absolute_seconds is null or p_absolute_seconds < 1 then
    raise exception 'sweep_console_sessions: the absolute limit must be a positive number of seconds' using errcode = 'P0001';
  end if;
  delete from platform.console_challenge where expires_at < app.now();
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  delete from platform.console_session where created_at < app.now() - make_interval(secs => p_absolute_seconds);
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  delete from platform.console_login_state where failures = 0 and (locked_until is null or locked_until < app.now());
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'platform.console_ms(timestamptz)', 'platform.console_ts(bigint)',
    'platform.console_session_put(text, uuid, bigint, bigint, bigint)', 'platform.console_session_get(text)',
    'platform.console_session_delete(text)', 'platform.console_sessions_delete_for(uuid)',
    'platform.console_challenge_put(text, uuid, bigint, text)', 'platform.console_challenge_get(text)', 'platform.console_challenge_delete(text)',
    'platform.console_failure_add(uuid)', 'platform.console_failure_clear(uuid)', 'platform.console_lock_set(uuid, bigint)', 'platform.console_lock_get(uuid)',
    'app.sweep_console_sessions(integer)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
  foreach f in array array[
    'platform.console_ms(timestamptz)', 'platform.console_ts(bigint)',
    'platform.console_session_put(text, uuid, bigint, bigint, bigint)', 'platform.console_session_get(text)',
    'platform.console_session_delete(text)', 'platform.console_sessions_delete_for(uuid)',
    'platform.console_challenge_put(text, uuid, bigint, text)', 'platform.console_challenge_get(text)', 'platform.console_challenge_delete(text)',
    'platform.console_failure_add(uuid)', 'platform.console_failure_clear(uuid)', 'platform.console_lock_set(uuid, bigint)', 'platform.console_lock_get(uuid)'] loop
    execute format('grant execute on function %s to booq_platform', f);
  end loop;
end $$;
grant execute on function app.sweep_console_sessions(integer) to booq_worker;
