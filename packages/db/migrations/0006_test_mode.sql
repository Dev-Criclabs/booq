-- F01-T26 / migration 0006: test-mode data flag and the registry of tables that carry it.
-- F01 design 7.6; FA 2.6 and 4.5. Requirement: PLAT-07-AC1. Decisions D4, D33, D100, D101.
-- go_live_purge (F01-T27) deletes from these tables in delete_order.

create table app.test_tables (
  table_schema text not null,
  table_name text not null,
  delete_order integer not null,       -- purge runs in ascending order: children before parents
  auto_flag boolean not null default true,   -- false: the flag is set by explicit code (app_user, tester invite, D100)
  primary key (table_schema, table_name)
);
alter table app.test_tables owner to booq_owner;

-- Sets is_test from the club status at insert time. SECURITY DEFINER so it can read the club
-- row whatever policy applies to the writer; it reveals nothing beyond a boolean for the row's own club.
create function app.set_is_test() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  new.is_test := coalesce((select c.status = 'testing' from public.club c where c.id = new.club_id), false);
  return new;
end $$;
alter function app.set_is_test() owner to booq_owner;
revoke all on function app.set_is_test() from public;

-- The flag is written once, at insert (PLAT-07-AC1). Nothing flips it later; the purge deletes rows.
create function app.keep_is_test() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if new.is_test is distinct from old.is_test then
    raise exception 'is_test cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.keep_is_test() owner to booq_owner;
revoke all on function app.keep_is_test() from public;

-- Called by the migration that creates a table with an is_test column.
create function app.register_test_table(p_table regclass, p_delete_order integer, p_auto_flag boolean default true)
returns void
language plpgsql set search_path = pg_catalog, pg_temp
as $$
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
end $$;
alter function app.register_test_table(regclass, integer, boolean) owner to booq_owner;
revoke all on function app.register_test_table(regclass, integer, boolean) from public;

-- Definer functions owned by booq_owner (this one, set_club_status in T20 ...) read the club row.
-- booq_owner is NOLOGIN and runs nothing but those functions, so it may see every club row; the
-- application roles keep their own restrictive tenant policy.
create policy club_definer_read on public.club for select to booq_owner using (true);
