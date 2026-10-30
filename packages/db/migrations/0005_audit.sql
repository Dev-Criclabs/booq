-- F01-T10 / migration 0005: the club audit log.
-- F01 design 8; FA 8.1. Requirements: PLAT-04-AC1, AC2, AC6, AC11. Review: SR-04, D104, SR-07.
--
-- Mechanism: a trigger on every audited table calls audit.write(), a SECURITY DEFINER function
-- owned by booq_audit, the only role with INSERT on audit_entry. The application roles can read
-- (the owner only) and never write. Personal values go only in pii_old / pii_new; the single
-- fenced path that may change those is audit.erase_pii(), owned by booq_anonymiser.

do $$
declare r text;
begin
  foreach r in array array['booq_audit', 'booq_anonymiser'] loop
    begin
      execute format('create role %I nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit', r);
    exception when duplicate_object then
      null; -- roles are cluster-wide
    end;
    execute format('alter role %I set timezone = %L', r, 'Asia/Bangkok');
  end loop;
  if not (select rolsuper from pg_roles where rolname = current_user) then
    execute format('grant booq_audit to %I', current_user);
    execute format('grant booq_anonymiser to %I', current_user);
  end if;
end $$;

grant usage on schema public to booq_audit, booq_anonymiser;
grant usage on schema audit to booq_audit, booq_anonymiser, booq_app, booq_worker, booq_platform;
grant create on schema audit to booq_owner;
grant usage on schema app to booq_audit, booq_anonymiser;
grant execute on function app.club_id(), app.user_id(), app.roles(), app.now() to booq_audit, booq_anonymiser;

-- Which tables are audited, which columns hold personal values (go to pii_*), which are secret
-- (a "set" / "changed" marker only, never the value).
create table audit.registry (
  table_schema text not null,
  table_name text not null,
  key_columns text[] not null,
  club_column text not null default 'club_id',
  pii_columns text[] not null default '{}',
  secret_columns text[] not null default '{}',
  primary key (table_schema, table_name),
  check (cardinality(key_columns) > 0)
);
alter table audit.registry owner to booq_owner;
grant select on audit.registry to booq_audit;

create table public.audit_entry (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,   -- stable order inside one transaction
  occurred_at timestamptz not null default app.now(),
  actor_type text not null check (actor_type in ('club_user', 'platform_staff', 'system')),
  actor_user_id uuid,
  actor_platform_staff_id uuid,
  actor_label text not null check (actor_label <> ''),
  support_session_id uuid,
  source text not null check (source in ('player_app', 'admin', 'coach_portal', 'platform', 'job', 'webhook')),
  action text not null check (action <> ''),
  record_type text not null,
  record_id uuid not null,
  record_key text,                 -- the key of a row that has no id column (a setting key, a weekday)
  old_value jsonb,                 -- changed columns only
  new_value jsonb,
  pii_old jsonb,                   -- personal values (SR-04); the only columns that may ever change
  pii_new jsonb,
  reason text,
  request_id text,
  primary key (club_id, id),
  check ((actor_type = 'club_user') = (actor_user_id is not null)),
  check ((actor_type = 'platform_staff') = (actor_platform_staff_id is not null))
);
create index audit_entry_record on public.audit_entry (club_id, record_type, record_id, occurred_at desc);
create index audit_entry_time on public.audit_entry (club_id, occurred_at desc);
create index audit_entry_actor on public.audit_entry (club_id, actor_type, actor_user_id, occurred_at desc);

-- One row per run of the erasure function (append-only).
create table public.audit_erasure (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  record_type text not null,
  record_id uuid not null,
  entries_changed integer not null check (entries_changed >= 0),
  erased_at timestamptz not null default app.now(),
  primary key (club_id, id)
);
create trigger audit_erasure_append_only before update or delete on public.audit_erasure
  for each row execute function app.refuse_change();
create trigger audit_erasure_no_truncate before truncate on public.audit_erasure
  for each statement execute function app.refuse_change();

-- Guard: an entry is never changed or removed, except that booq_anonymiser may replace the values
-- inside pii_old / pii_new with the placeholder. SECURITY INVOKER on purpose: current_user is the
-- role that runs the statement, never a session setting (SR-15).
create function audit.placeholder_only(p_old jsonb, p_new jsonb) returns boolean
language sql immutable set search_path = pg_catalog
as $$
  select case
    when p_old is null or p_new is null then p_old is null and p_new is null
    else (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_old) k)
       = (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_new) k)
      and coalesce((select bool_and(v = '"[erased]"'::jsonb) from jsonb_each(p_new) e(k, v)), true)
  end
$$;

create function audit.entry_guard() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and current_user = 'booq_anonymiser' then
    -- nested on purpose: only this role may reach placeholder_only
    if (to_jsonb(new) - 'pii_old' - 'pii_new') = (to_jsonb(old) - 'pii_old' - 'pii_new') then
      if audit.placeholder_only(old.pii_old, new.pii_old) and audit.placeholder_only(old.pii_new, new.pii_new) then
        return new;
      end if;
    end if;
  end if;
  raise exception 'audit_entry is append-only' using errcode = 'P0001';
end $$;
create trigger audit_entry_guard before update or delete on public.audit_entry
  for each row execute function audit.entry_guard();
create trigger audit_entry_no_truncate before truncate on public.audit_entry
  for each statement execute function audit.entry_guard();

alter table public.audit_entry owner to booq_owner;
alter table public.audit_erasure owner to booq_owner;
alter table public.audit_entry enable row level security;
alter table public.audit_entry force row level security;
alter table public.audit_erasure enable row level security;
alter table public.audit_erasure force row level security;
revoke all on public.audit_entry, public.audit_erasure from public;

create policy audit_entry_tenant on public.audit_entry as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy audit_erasure_tenant on public.audit_erasure as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy audit_entry_owner_read on public.audit_entry for select to booq_app
  using (app.has_any_role('owner'));
-- The writer takes the club from the audited row itself (a job has no club context).
create policy audit_entry_insert on public.audit_entry for insert to booq_audit
  with check (true);
create policy audit_entry_erase_read on public.audit_entry for select to booq_anonymiser
  using (club_id = app.club_id());
create policy audit_entry_erase on public.audit_entry for update to booq_anonymiser
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy audit_erasure_insert on public.audit_erasure for insert to booq_anonymiser
  with check (club_id = app.club_id());

grant select on public.audit_entry to booq_app;
grant insert on public.audit_entry to booq_audit;
grant select (club_id, id, record_type, record_id, pii_old, pii_new), update (pii_old, pii_new) on public.audit_entry to booq_anonymiser;
grant insert on public.audit_erasure to booq_anonymiser;

-- The writer. Not callable by the application roles: they use audit.note() and the triggers.
-- The actor comes from the transaction-local settings (F01-T11 sets them in withClubTx):
--   app.actor_platform_staff_id  a BOOQ staff member (then source is 'platform')
--   app.user_id                  a club user; app.source is then required
--   neither                      a system actor (a job), source 'job' unless app.source says otherwise
--   app.actor_label, app.support_session_id, app.reason, app.request_id
create function audit.write(
  p_club uuid, p_action text, p_record_type text, p_record_id uuid, p_record_key text,
  p_old jsonb, p_new jsonb, p_pii_old jsonb, p_pii_new jsonb
) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_user uuid := app.user_id();
  v_source text := nullif(current_setting('app.source', true), '');
  v_label text := nullif(current_setting('app.actor_label', true), '');
  v_type text;
begin
  if p_club is null then
    raise exception 'audit entry has no club';
  end if;
  if v_staff is not null then
    v_type := 'platform_staff';
    v_source := 'platform';
    v_user := null;
    v_label := coalesce(v_label, 'BOOQ staff');
  elsif v_user is not null then
    v_type := 'club_user';
    if v_source is null then
      raise exception 'audit entry for a club user needs app.source';
    end if;
    v_label := coalesce(v_label, v_user::text);
  else
    v_type := 'system';
    v_source := coalesce(v_source, 'job');
    v_label := coalesce(v_label, 'system');
  end if;

  insert into public.audit_entry (
    club_id, actor_type, actor_user_id, actor_platform_staff_id, actor_label, support_session_id, source,
    action, record_type, record_id, record_key, old_value, new_value, pii_old, pii_new, reason, request_id
  ) values (
    p_club, v_type, v_user, v_staff, v_label, nullif(current_setting('app.support_session_id', true), '')::uuid, v_source,
    p_action, p_record_type, p_record_id, p_record_key, p_old, p_new, p_pii_old, p_pii_new,
    nullif(current_setting('app.reason', true), ''), nullif(current_setting('app.request_id', true), '')
  );
end $$;

-- The trigger function: works out the changed columns of the row and hands them to audit.write.
create function audit.record() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  r audit.registry%rowtype;
  o jsonb;
  n jsonb;
  rec jsonb;
  k text;
  old_c jsonb := '{}';
  new_c jsonb := '{}';
  old_p jsonb := '{}';
  new_p jsonb := '{}';
  v_club uuid;
  v_id uuid;
  v_key text;
begin
  select * into r from audit.registry where table_schema = tg_table_schema and table_name = tg_table_name;
  if not found then
    raise exception 'audit trigger on %.%, which is not in audit.registry', tg_table_schema, tg_table_name;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then n := to_jsonb(new); end if;
  rec := coalesce(n, o);
  v_club := (rec ->> r.club_column)::uuid;

  for k in select jsonb_object_keys(rec) loop
    if tg_op = 'UPDATE' and (o -> k) is not distinct from (n -> k) then
      continue;
    end if;
    if k = any (r.secret_columns) then
      if tg_op <> 'DELETE' then
        new_c := new_c || jsonb_build_object(k, case when tg_op = 'INSERT' then 'set' else 'changed' end);
      end if;
    elsif k = any (r.pii_columns) then
      if o is not null then old_p := old_p || jsonb_build_object(k, o -> k); end if;
      if n is not null then new_p := new_p || jsonb_build_object(k, n -> k); end if;
    else
      if o is not null then old_c := old_c || jsonb_build_object(k, o -> k); end if;
      if n is not null then new_c := new_c || jsonb_build_object(k, n -> k); end if;
    end if;
  end loop;

  if tg_op = 'UPDATE' and old_c = '{}' and new_c = '{}' and old_p = '{}' and new_p = '{}' then
    return null;
  end if;

  if rec ? 'id' and r.key_columns = array['id'] then
    v_id := (rec ->> 'id')::uuid;
  else
    select string_agg(rec ->> kc, '/' order by ord) into v_key from unnest(r.key_columns) with ordinality u(kc, ord);
    v_id := md5(tg_table_name || ':' || v_club::text || ':' || v_key)::uuid;
  end if;
  if rec ? 'id' and r.key_columns = array['id'] then v_key := null; end if;

  perform audit.write(
    v_club, lower(tg_op), tg_table_name, v_id, v_key,
    case when o is null then null else nullif(old_c, '{}') end,
    case when n is null then null else nullif(new_c, '{}') end,
    case when o is null then null else nullif(old_p, '{}') end,
    case when n is null then null else nullif(new_p, '{}') end
  );
  return null;
end $$;

-- Events that are not a row change (a support session opened, a booking moved ...). The club
-- is always the one in the context, never an argument (SR-07).
create function audit.note(
  p_action text, p_record_type text, p_record_id uuid, p_detail jsonb default null, p_pii jsonb default null
) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null then
    raise exception 'audit.note needs a club in the context';
  end if;
  perform audit.write(app.club_id(), p_action, p_record_type, p_record_id, null, null, p_detail, null, p_pii);
end $$;

-- Erasure (PDPA delete): replaces the values inside pii_old / pii_new of one record's entries with
-- the placeholder, keeps the keys and every other column, and records the run. Owned by
-- booq_anonymiser; only booq_owner (and so the definer function app.anonymise_user, later) may call it.
create function audit.erase_pii(p_record_type text, p_record_id uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_n integer;
begin
  if v_club is null then
    raise exception 'audit.erase_pii needs a club in the context';
  end if;
  update public.audit_entry e
     set pii_old = (select jsonb_object_agg(k, '"[erased]"'::jsonb) from jsonb_object_keys(e.pii_old) k),
         pii_new = (select jsonb_object_agg(k, '"[erased]"'::jsonb) from jsonb_object_keys(e.pii_new) k)
   where e.club_id = v_club and e.record_type = p_record_type and e.record_id = p_record_id
     and (e.pii_old is not null or e.pii_new is not null);
  get diagnostics v_n = row_count;
  insert into public.audit_erasure (club_id, record_type, record_id, entries_changed)
  values (v_club, p_record_type, p_record_id, v_n);
  return v_n;
end $$;

alter function audit.write(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, jsonb) owner to booq_audit;
alter function audit.record() owner to booq_audit;
alter function audit.note(text, text, uuid, jsonb, jsonb) owner to booq_audit;
alter function audit.erase_pii(text, uuid) owner to booq_anonymiser;
alter function audit.entry_guard() owner to booq_owner;
alter function audit.placeholder_only(jsonb, jsonb) owner to booq_owner;
revoke all on function audit.write(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function audit.record() from public;
revoke all on function audit.note(text, text, uuid, jsonb, jsonb) from public;
revoke all on function audit.erase_pii(text, uuid) from public;
revoke all on function audit.entry_guard() from public;
revoke all on function audit.placeholder_only(jsonb, jsonb) from public;
grant execute on function audit.note(text, text, uuid, jsonb, jsonb) to booq_app, booq_worker, booq_platform;
grant execute on function audit.erase_pii(text, uuid) to booq_owner;
grant execute on function audit.placeholder_only(jsonb, jsonb) to booq_anonymiser;
grant execute on function audit.write(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, jsonb) to booq_audit;
-- Trigger functions need no EXECUTE grant at fire time.

-- Putting a table under audit: register it and attach the trigger. Migrations only.
create function audit.register(
  p_table regclass, p_key_columns text[], p_club_column text default 'club_id',
  p_pii text[] default '{}', p_secret text[] default '{}'
) returns void
language plpgsql set search_path = pg_catalog, pg_temp
as $$
declare
  v_schema text;
  v_name text;
begin
  select n.nspname, c.relname into v_schema, v_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_table;
  insert into audit.registry (table_schema, table_name, key_columns, club_column, pii_columns, secret_columns)
  values (v_schema, v_name, p_key_columns, p_club_column, p_pii, p_secret);
  execute format('create trigger audit_row after insert or update or delete on %s for each row execute function audit.record()', p_table);
end $$;
alter function audit.register(regclass, text[], text, text[], text[]) owner to booq_owner;
revoke all on function audit.register(regclass, text[], text, text[], text[]) from public;

select audit.register('public.club', array['id'], 'id', array['owner_name', 'owner_phone', 'owner_line', 'owner_email']);
select audit.register('public.club_feature', array['feature_key']);
select audit.register('public.club_setting', array['key']);
select audit.register('public.location', array['id']);
select audit.register('public.resource', array['id']);
select audit.register('public.opening_hours', array['weekday']);
select audit.register('public.club_pause', array['id']);
select audit.register('public.club_status_change', array['id']);
