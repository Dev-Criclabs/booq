-- F01-T17c / migration 0056: housekeeping for staff enrolment links (0055).
--   * app.sweep_staff_enrolments(keep_seconds): for the worker; removes links that expired, or were used, more than that long ago.
-- A new file because 0055 was already on main when the sweep was added.

-- Housekeeping for the worker: a link that expired, or was used, more than p_keep_seconds ago. The audit log keeps the facts
-- (issued, enrolled); the row holds nothing else worth keeping. Reads and returns no club data.
create function app.sweep_staff_enrolments(p_keep_seconds integer) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
begin
  if p_keep_seconds is null or p_keep_seconds < 1 then
    raise exception 'sweep_staff_enrolments: the keep time must be a positive number of seconds' using errcode = 'P0001';
  end if;
  delete from platform.staff_enrolment
   where least(expires_at, coalesce(used_at, expires_at)) < app.now() - make_interval(secs => p_keep_seconds);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
alter function app.sweep_staff_enrolments(integer) owner to booq_owner;
revoke all on function app.sweep_staff_enrolments(integer) from public;
grant execute on function app.sweep_staff_enrolments(integer) to booq_worker;
