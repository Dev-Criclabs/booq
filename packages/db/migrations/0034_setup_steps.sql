-- F01-T23 part a / migration 0034: what blocks a status move, and the P3 progress list.
-- Requirements: PLAT-01-AC2, AC3, AC9, AC12; review T20 R2 and T18 notes. F01 design 7.1 and 9.3.
--
--   Draft to Testing: every registered setup step is done. The five P2 steps are registered here;
--     a later feature registers the owner's A0 steps (products, staff and coaches, brand) with
--     app.register_setup_step, and they block the move too. Each step has a check function and says who owes it.
--   Testing to Live: every check named in platform.config 'required_launch_checks' has a pass row in
--     platform.launch_check. The list is data (design 9.3); a key that is not in the list does not count;
--     no configured list means no Go live (fail closed).
-- app.status_blockers replaces migration 0032's version and keeps its contract (a jsonb array; empty
-- means clear). Each item carries who owes it.

create policy location_definer_read on public.location for select to booq_owner using (true);

create table app.setup_steps (
  step_key text primary key check (step_key <> ''),
  position integer not null,
  owed_by text not null check (owed_by in ('booq', 'owner')),
  check_fn regprocedure not null,
  created_at timestamptz not null default app.now()
);
alter table app.setup_steps owner to booq_owner;
revoke all on app.setup_steps from public;

create function app.register_setup_step(p_key text, p_position integer, p_owed_by text, p_fn regprocedure) returns void
language sql set search_path = pg_catalog
as $$ insert into app.setup_steps (step_key, position, owed_by, check_fn) values (p_key, p_position, p_owed_by, p_fn) $$;
alter function app.register_setup_step(text, integer, text, regprocedure) owner to booq_owner;
revoke all on function app.register_setup_step(text, integer, text, regprocedure) from public;

-- Runs one step's check for a club. The function name comes from the registry, written by migrations only.
create function app.setup_step_done(p_fn regprocedure, p_club uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare v_ok boolean;
begin
  execute format('select %s($1)', p_fn::regproc::text) into v_ok using p_club;
  return coalesce(v_ok, false);
end $$;
alter function app.setup_step_done(regprocedure, uuid) owner to booq_owner;
revoke all on function app.setup_step_done(regprocedure, uuid) from public;

-- The five P2 steps (PRD Flow J). Each reads the club's own data as the table owner.
create function app.setup_basics(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.club c
     where c.id = p_club and c.template_id is not null
       and btrim(coalesce(c.owner_name, '')) <> '' and btrim(coalesce(c.owner_phone, '')) <> ''
       and btrim(coalesce(c.owner_line, '')) <> '' and btrim(coalesce(c.owner_email, '')) <> ''
  ) $$;
create function app.setup_plan(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select exists (select 1 from public.club c where c.id = p_club and c.billing_starts_at is not null) $$;
create function app.setup_courts_hours(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from public.location l where l.club_id = p_club)
     and exists (select 1 from public.resource r where r.club_id = p_club and r.active)
     and exists (select 1 from public.opening_hours h where h.club_id = p_club) $$;
create function app.setup_line(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select exists (select 1 from public.line_connection l where l.club_id = p_club and l.tested_at is not null) $$;
create function app.setup_payments(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from public.club c where c.id = p_club and c.payment_option is not null)
     and exists (select 1 from public.payment_connection p where p.club_id = p_club and p.tested_at is not null) $$;

do $$
declare f text;
begin
  foreach f in array array['app.setup_basics(uuid)', 'app.setup_plan(uuid)', 'app.setup_courts_hours(uuid)', 'app.setup_line(uuid)', 'app.setup_payments(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

select app.register_setup_step('basics', 10, 'booq', 'app.setup_basics(uuid)'::regprocedure);
select app.register_setup_step('plan', 20, 'booq', 'app.setup_plan(uuid)'::regprocedure);
select app.register_setup_step('courts_hours', 30, 'booq', 'app.setup_courts_hours(uuid)'::regprocedure);
select app.register_setup_step('line', 40, 'booq', 'app.setup_line(uuid)'::regprocedure);
select app.register_setup_step('payments', 50, 'booq', 'app.setup_payments(uuid)'::regprocedure);

-- The Go live checks of decision D108 and design 9.3, with who owes each. A proposal an admin can change
-- in platform.config; the owner of each is the party that has to act, not who presses the button.
insert into platform.config (key, value) values ('required_launch_checks', jsonb_build_array(
  jsonb_build_object('key', 'line_test', 'owed_by', 'booq'),
  jsonb_build_object('key', 'pay_tap_limit_set', 'owed_by', 'booq'),
  jsonb_build_object('key', 'beam_key_swap', 'owed_by', 'booq'),
  jsonb_build_object('key', 'receipt_prefix_set', 'owed_by', 'booq'),
  jsonb_build_object('key', 'owner_signed_in', 'owed_by', 'owner'),
  jsonb_build_object('key', 'owner_verified', 'owed_by', 'booq'),
  jsonb_build_object('key', 'product_priced', 'owed_by', 'owner'),
  jsonb_build_object('key', 'template_required_settings', 'owed_by', 'owner'),
  jsonb_build_object('key', 'test_booking_completed', 'owed_by', 'booq'),
  jsonb_build_object('key', 'no_open_launch_failure', 'owed_by', 'booq')
)) on conflict (key) do nothing;

create or replace function app.status_blockers(p_club uuid, p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_cfg jsonb;
begin
  if p_from = 'draft' and p_to = 'testing' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('item', s.step_key, 'owed_by', s.owed_by) order by s.position, s.step_key)
        from app.setup_steps s where not app.setup_step_done(s.check_fn, p_club)
    ), '[]'::jsonb);
  end if;
  if p_from = 'testing' and p_to = 'live' then
    select c.value into v_cfg from platform.config c where c.key = 'required_launch_checks';
    if v_cfg is null or jsonb_typeof(v_cfg) <> 'array' or jsonb_array_length(v_cfg) = 0 then
      return jsonb_build_array(jsonb_build_object('item', 'required_launch_checks_not_configured', 'owed_by', 'booq', 'result', 'missing'));
    end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object('item', e.r ->> 'key', 'owed_by', e.r ->> 'owed_by', 'result', coalesce(c.result, 'missing')) order by e.ord)
        from jsonb_array_elements(v_cfg) with ordinality as e(r, ord)
        left join platform.launch_check c on c.club_id = p_club and c.check_key = e.r ->> 'key'
       where coalesce(c.result, 'missing') <> 'pass'
    ), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;

-- P3: what is done, what is missing and who owes it. Null for a club the caller cannot see (404).
create function platform.club_progress(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_cfg jsonb;
begin
  if not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    return null;
  end if;
  select c.value into v_cfg from platform.config c where c.key = 'required_launch_checks';
  return jsonb_build_object(
    'setup', coalesce((
      select jsonb_agg(jsonb_build_object('item', s.step_key, 'done', app.setup_step_done(s.check_fn, p_club), 'owed_by', s.owed_by) order by s.position, s.step_key)
        from app.setup_steps s
    ), '[]'::jsonb),
    'launch', case when v_cfg is null or jsonb_typeof(v_cfg) <> 'array' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('item', e.r ->> 'key', 'result', coalesce(c.result, 'missing'), 'owed_by', e.r ->> 'owed_by') order by e.ord)
        from jsonb_array_elements(v_cfg) with ordinality as e(r, ord)
        left join platform.launch_check c on c.club_id = p_club and c.check_key = e.r ->> 'key'
    ), '[]'::jsonb) end
  );
end $$;
alter function platform.club_progress(uuid) owner to booq_owner;
revoke all on function platform.club_progress(uuid) from public;
grant execute on function platform.club_progress(uuid) to booq_platform;

-- A specialist who creates a club is assigned to it by their own insert; they cannot assign anyone else.
-- The creator cannot read the new row before the assignment exists, so the check is a definer helper.
create function platform.created_club(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select platform.staff_role() is not null
     and exists (select 1 from public.club c where c.id = p_club and c.created_by_staff = platform.staff_id())
$$;
alter function platform.created_club(uuid) owner to booq_owner;
revoke all on function platform.created_club(uuid) from public;
grant execute on function platform.created_club(uuid) to booq_platform;

drop policy assignment_admin_insert on platform.staff_assignment;
create policy assignment_insert on platform.staff_assignment for insert to booq_platform
  with check (platform.is_admin() or (staff_id = platform.staff_id() and platform.created_club(club_id)));
