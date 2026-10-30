-- F01-T27 / migration 0013: the Go live purge and the test flag on audit entries.
-- F01 design 7.6; FA 2.6. Requirements: PLAT-07-AC3, AC4, AC8, PLAT-01-AC6. Decisions D4, D100, D101,
-- review SR-15 (the fence is the role that runs the statement, never a session setting), SR-07.
--
-- app.go_live_purge() deletes the is_test rows of the club in the context, in delete_order, in one
-- transaction. It runs as booq_purge, the only role that the append-only guards let delete, and
-- only rows flagged is_test. The Go live transition (app.set_club_status, F01-T20) is its caller.

do $$
begin
  begin
    create role booq_purge nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
  exception when duplicate_object then null;
  end;
  alter role booq_purge set timezone = 'Asia/Bangkok';
  if not (select rolsuper from pg_roles where rolname = current_user) then
    execute format('grant booq_purge to %I', current_user);
  end if;
end $$;

-- An audit entry is test data only when its subject row is (D101): a setting changed in Testing
-- keeps its entry after Go live, an entry about a test booking goes with the booking.
alter table public.audit_entry add column is_test boolean not null default false;

drop function audit.write(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, jsonb);
create function audit.write(
  p_club uuid, p_action text, p_record_type text, p_record_id uuid, p_record_key text,
  p_old jsonb, p_new jsonb, p_pii_old jsonb, p_pii_new jsonb, p_is_test boolean default false
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
    action, record_type, record_id, record_key, old_value, new_value, pii_old, pii_new, reason, request_id, is_test
  ) values (
    p_club, v_type, v_user, v_staff, v_label, nullif(current_setting('app.support_session_id', true), '')::uuid, v_source,
    p_action, p_record_type, p_record_id, p_record_key, p_old, p_new, p_pii_old, p_pii_new,
    nullif(current_setting('app.reason', true), ''), nullif(current_setting('app.request_id', true), ''), coalesce(p_is_test, false)
  );
end $$;
alter function audit.write(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, jsonb, boolean) owner to booq_audit;
revoke all on function audit.write(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function audit.write(uuid, text, text, uuid, text, jsonb, jsonb, jsonb, jsonb, boolean) to booq_audit, booq_purge;

create or replace function audit.record() returns trigger
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
    case when n is null then null else nullif(new_p, '{}') end,
    coalesce((rec ->> 'is_test')::boolean, false)   -- an entry is test data only when its subject row is (D101)
  );
  return null;
end $$;

-- The append-only guards, with the one fenced exception: a DELETE of a row flagged is_test, run by
-- booq_purge. The fence is current_user, which a session setting cannot change. Updates and
-- truncates stay refused for everyone.
create or replace function app.refuse_change() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'booq_purge' then
      if coalesce((to_jsonb(old) ->> 'is_test')::boolean, false) then
        return old;
      end if;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;

create or replace function audit.entry_guard() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if current_user = 'booq_purge' and old.is_test then
      return old;
    end if;
  elsif tg_op = 'UPDATE' and current_user = 'booq_anonymiser' then
    -- nested on purpose: only this role may reach placeholder_only
    if (to_jsonb(new) - 'pii_old' - 'pii_new') = (to_jsonb(old) - 'pii_old' - 'pii_new') then
      if audit.placeholder_only(old.pii_old, new.pii_old) and audit.placeholder_only(old.pii_new, new.pii_new) then
        return new;
      end if;
    end if;
  end if;
  raise exception 'audit_entry is append-only' using errcode = 'P0001';
end $$;

-- What booq_purge may touch: the is_test rows of the club in the context, nothing else.
grant usage on schema app, audit, public to booq_purge;
grant execute on function app.club_id(), app.now() to booq_purge;
grant select on app.test_tables to booq_purge;
grant select (id, status) on public.club to booq_purge;
create policy club_purge_read on public.club for select to booq_purge using (id = app.club_id());

create or replace function app.register_test_table(p_table regclass, p_delete_order integer, p_auto_flag boolean default true)
returns void
language plpgsql set search_path = pg_catalog, pg_temp
as $f$
declare
  v_schema text;
  v_name text;
begin
  select n.nspname, c.relname into v_schema, v_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_table;
  if not exists (select 1 from pg_attribute where attrelid = p_table and attname = 'is_test' and not attisdropped) then
    raise exception '% has no is_test column', p_table;
  end if;
  insert into app.test_tables (table_schema, table_name, delete_order, auto_flag)
  values (v_schema, v_name, p_delete_order, p_auto_flag);
  if p_auto_flag then
    execute format('create trigger is_test_set before insert on %s for each row execute function app.set_is_test()', p_table);
  end if;
  execute format('create trigger is_test_keep before update on %s for each row execute function app.keep_is_test()', p_table);
  -- the purge role: see and delete the test rows of the club in the context
  execute format('grant select, delete on %s to booq_purge', p_table);
  execute format('create policy purge_select on %s for select to booq_purge using (is_test and club_id = app.club_id())', p_table);
  execute format('create policy purge_delete on %s for delete to booq_purge using (is_test and club_id = app.club_id())', p_table);
end $f$;

-- The tables registered before this migration get the same grants and policies.
do $$
declare r record;
begin
  for r in select table_schema, table_name from app.test_tables loop
    execute format('grant select, delete on %I.%I to booq_purge', r.table_schema, r.table_name);
    execute format('create policy purge_select on %I.%I for select to booq_purge using (is_test and club_id = app.club_id())', r.table_schema, r.table_name);
    execute format('create policy purge_delete on %I.%I for delete to booq_purge using (is_test and club_id = app.club_id())', r.table_schema, r.table_name);
  end loop;
end $$;

-- audit_entry is swept last (the purge's own deletes write entries about test rows, which are test data too).
select app.register_test_table('public.audit_entry', 1000, false);

-- P6 (FA 8.2): one platform log entry for the purge. platform.audit_log is owned by booq_owner and
-- append-only; this definer function is the purge's only way in (the platform writer of F01-T18 is
-- not required for it).
create function platform.log_purge(p_club uuid, p_detail jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_name text;
begin
  if v_staff is not null then
    select s.display_name into v_name from platform.platform_staff s where s.id = v_staff;
  end if;
  insert into platform.audit_log (staff_id, staff_name_at_time, action, club_id, target_type, target_id, detail)
  values (v_staff, v_name, 'club.test_data_purged', p_club, 'club', p_club::text, p_detail);
end $$;
alter function platform.log_purge(uuid, jsonb) owner to booq_owner;
revoke all on function platform.log_purge(uuid, jsonb) from public;
grant usage on schema platform to booq_purge;
grant execute on function platform.log_purge(uuid, jsonb) to booq_purge;

-- The purge. Club from the context only. Only while the club is in Testing. All or nothing.
create function app.go_live_purge() returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_status text;
  v_counts jsonb := '{}';
  r record;
  n bigint;
begin
  if v_club is null then
    raise exception 'go_live_purge needs a club in the context' using errcode = 'P0001';
  end if;
  select c.status into v_status from public.club c where c.id = v_club;
  if v_status is distinct from 'testing' then
    raise exception 'go_live_purge runs only while the club is in Testing' using errcode = 'P0001';
  end if;
  for r in select table_schema, table_name from app.test_tables order by delete_order, table_schema, table_name loop
    execute format('delete from %I.%I where club_id = $1 and is_test', r.table_schema, r.table_name) using v_club;
    get diagnostics n = row_count;
    v_counts := v_counts || jsonb_build_object(r.table_name, n);
  end loop;
  -- one entry in the club's own log and one in P6: counts only, never row content
  perform audit.write(v_club, 'go_live.purge', 'club', v_club, null, null, v_counts, null, null, false);
  perform platform.log_purge(v_club, v_counts);
  return v_counts;
end $$;
alter function app.go_live_purge() owner to booq_purge;
revoke all on function app.go_live_purge() from public;
-- Only the Go live transition (a definer function owned by booq_owner, F01-T20) calls it.
grant execute on function app.go_live_purge() to booq_owner;
