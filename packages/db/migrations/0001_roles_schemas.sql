-- F01-T03 / migration 0001: roles, schemas, extensions and request-context helpers.
-- F01 design 3.1; FA 4.1 to 4.3. Requirements: CC-1, CC-2, PDPA-01-AC1.

-- Four database roles. NOLOGIN: the operator creates the real login users and makes
-- them members (docs/ops). None can bypass row-level security.
do $$
declare r text;
begin
  foreach r in array array['booq_owner', 'booq_app', 'booq_worker', 'booq_platform'] loop
    begin
      execute format('create role %I nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit', r);
    exception when duplicate_object then
      null; -- roles are cluster-wide; another database on this cluster created it
    end;
    execute format('alter role %I set timezone = %L', r, 'Asia/Bangkok');
  end loop;
  -- A non-superuser migrator (hosted Postgres) must be able to create objects as booq_owner.
  if not (select rolsuper from pg_roles where rolname = current_user) then
    execute format('grant booq_owner to %I', current_user);
  end if;
end $$;

-- Extensions: btree_gist (exclusion constraints, F03), pgcrypto. Hosted Supabase keeps
-- extensions in the "extensions" schema; plain Postgres uses public.
do $$
declare s text := case when exists (select 1 from pg_namespace where nspname = 'extensions') then 'extensions' else 'public' end;
begin
  execute format('create extension if not exists btree_gist schema %I', s);
  execute format('create extension if not exists pgcrypto schema %I', s);
end $$;

create schema if not exists app authorization booq_owner;
create schema if not exists platform authorization booq_owner;
create schema if not exists audit authorization booq_owner;

-- The public schema: nobody creates in it except the owner and the migrating user, and the
-- Supabase REST roles (anon, authenticated) get nothing at all (FA 4.1, decision R3).
-- Revoking PUBLIC's USAGE is what keeps those roles out, so the four BOOQ roles are
-- granted USAGE explicitly.
revoke all on schema public from public;
grant usage on schema public to booq_owner, booq_app, booq_worker, booq_platform;
grant usage, create on schema public to booq_owner;
do $$
begin
  execute format('grant usage, create on schema public to %I', current_user);
end $$;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema public from %I', r);
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;

-- app: usable by the three application roles. platform: BOOQ staff and the worker only.
-- audit: nobody directly (the writer function comes in migration 0005).
grant usage on schema app to booq_app, booq_worker, booq_platform;
grant usage on schema platform to booq_platform, booq_worker;

-- Request context. withClubTx (F01-T04) sets these with set_config(..., true), i.e.
-- transaction-local, so a pooled connection never carries a context to the next request.
-- With no context they return null / an empty set, so every club_id = app.club_id()
-- comparison is false and queries return no rows (fail closed).
create function app.club_id() returns uuid
language sql stable set search_path = pg_catalog
as $$ select nullif(current_setting('app.club_id', true), '')::uuid $$;

create function app.user_id() returns uuid
language sql stable set search_path = pg_catalog
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app.roles() returns text[]
language sql stable set search_path = pg_catalog
as $$ select coalesce(string_to_array(nullif(current_setting('app.roles', true), ''), ','), array[]::text[]) $$;

create function app.has_any_role(variadic wanted text[]) returns boolean
language sql stable set search_path = pg_catalog
as $$ select app.roles() && wanted $$;

-- Production time. Always the database clock; the test harness replaces this function in
-- test databases only (packages/db/src/testing), so production cannot have an override.
create function app.now() returns timestamptz
language sql stable set search_path = pg_catalog
as $$ select now() $$;

do $$
declare f text;
begin
  foreach f in array array['app.club_id()', 'app.user_id()', 'app.roles()', 'app.has_any_role(text[])', 'app.now()'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app, booq_worker, booq_platform', f);
  end loop;
end $$;
