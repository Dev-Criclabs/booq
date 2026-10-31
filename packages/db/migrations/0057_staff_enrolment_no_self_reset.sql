-- QA-F01-1 (D123, ROLE-02-AC7): an admin cannot issue a 'reset' link for their own account; only another admin may.
-- The function keeps its owner, grants and body from 0055; only the self check is added.

create or replace function platform.issue_staff_enrolment(p_staff uuid, p_token_hash text, p_purpose text) returns timestamptz
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
  if p_purpose = 'reset' and p_staff = v_actor then
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
