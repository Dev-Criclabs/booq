-- Migration 0055: first-factor enrolment for BOOQ staff (F01-T17c; ROLE-02-AC1, AC4; SR-06; D123, D148).
-- A newly invited teammate, or one whose second factor an admin reset, has no authenticator and cannot sign in. The
-- admin gets a single-use link; whoever holds it sets a password and enrols an authenticator at apps/staff-invite.
-- Only the sha-256 of the link token is stored. The life of a link is platform config `console_enrolment_ttl_hours`,
-- set by a BOOQ admin; none is shipped (no invented setting), and issuing a link before it is set is refused.
-- The table is reached only through these definer functions, for booq_platform. Errors are `enrolment:<code>` (P0001).
--   * platform.issue_staff_enrolment(staff, token_hash, purpose): admin only; any earlier unused link of that member
--     is removed, so one link is live at a time; P6 `staff.enrolment_issued` (purpose only, never the token).
--   * platform.staff_enrolment_open(token_hash): before sign-in; the member behind a link that is unused and unexpired.
--   * platform.staff_enrolment_finish(token_hash): marks the link used, once; the context must be that member; P6 `staff.enrolled`.

create table platform.staff_enrolment (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  staff_id uuid not null references platform.platform_staff (id),
  purpose text not null check (purpose in ('invite', 'reset')),
  created_by uuid not null references platform.platform_staff (id),
  created_at timestamptz not null default app.now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index staff_enrolment_by_staff on platform.staff_enrolment (staff_id);
alter table platform.staff_enrolment owner to booq_owner;
alter table platform.staff_enrolment enable row level security;
revoke all on platform.staff_enrolment from public;

create function platform.issue_staff_enrolment(p_staff uuid, p_token_hash text, p_purpose text) returns timestamptz
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := platform.staff_id();
  v_ttl jsonb;
  v_expires timestamptz;
begin
  if v_actor is null or not platform.is_admin() then
    raise exception 'enrolment:forbidden' using errcode = 'P0001';
  end if;
  if p_purpose is null or p_purpose not in ('invite', 'reset') or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'enrolment:invalid' using errcode = 'P0001';
  end if;
  if not exists (select 1 from platform.platform_staff s where s.id = p_staff and s.active) then
    raise exception 'enrolment:not_found' using errcode = 'P0001';
  end if;
  select c.value into v_ttl from platform.config c where c.key = 'console_enrolment_ttl_hours';
  if v_ttl is null or jsonb_typeof(v_ttl) <> 'number' or (v_ttl #>> '{}')::numeric <= 0 then
    raise exception 'enrolment:not_configured' using errcode = 'P0001';
  end if;
  v_expires := app.now() + make_interval(secs => ((v_ttl #>> '{}')::numeric * 3600)::double precision);
  delete from platform.staff_enrolment where staff_id = p_staff and used_at is null;
  insert into platform.staff_enrolment (token_hash, staff_id, purpose, created_by, expires_at) values (p_token_hash, p_staff, p_purpose, v_actor, v_expires);
  perform platform.write_audit('staff.enrolment_issued', null, 'platform_staff', p_staff::text, jsonb_build_object('purpose', p_purpose), null, null);
  return v_expires;
end $$;

create function platform.staff_enrolment_open(p_token_hash text)
returns table (staff_id uuid, auth_user_id uuid, display_name text, expires_at timestamptz)
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select e.staff_id, s.auth_user_id, s.display_name, e.expires_at
    from platform.staff_enrolment e join platform.platform_staff s on s.id = e.staff_id
   where e.token_hash = p_token_hash and e.used_at is null and e.expires_at > app.now() and s.active
$$;

create function platform.staff_enrolment_finish(p_token_hash text) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_staff uuid;
  v_purpose text;
begin
  update platform.staff_enrolment e set used_at = app.now()
   where e.token_hash = p_token_hash and e.used_at is null and e.expires_at > app.now() and e.staff_id = platform.staff_id()
     and exists (select 1 from platform.platform_staff s where s.id = e.staff_id and s.active)
  returning e.staff_id, e.purpose into v_staff, v_purpose;
  if v_staff is null then
    return false;
  end if;
  perform platform.write_audit('staff.enrolled', null, 'platform_staff', v_staff::text, jsonb_build_object('purpose', v_purpose), null, null);
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'platform.issue_staff_enrolment(uuid, text, text)', 'platform.staff_enrolment_open(text)', 'platform.staff_enrolment_finish(text)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_platform', f);
  end loop;
end $$;
