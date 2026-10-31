-- D167, PLAT-02-AC8, LINE-06: when BOOQ staff save a LINE or Beam connection in the console, the result of the probe on the values
-- just typed is recorded in platform.club_health, so P1 shows a connection that was saved although its check failed ("save anyway"),
-- and a later pass clears it. The console holds no key that can read a stored secret (SR-03): this records a code only.
--   platform.record_connection_check(club, check, reason)
--     * check: line_token, beam_keys or beam_charge (the keys of F10's 0604 and BE-C's 0699); reason null: ok, else a short code;
--     * the caller is a platform staff member who may see the club and may change it now (platform.club_editable);
--     * changed_at moves only when the status changes, checked_at every time (like app.report_payment_health).

create function platform.record_connection_check(p_club uuid, p_check text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text := case when p_reason is null then 'ok' else 'failed' end;
begin
  if platform.staff_id() is null then
    raise exception 'connection_check:forbidden' using errcode = 'P0001';
  end if;
  if not platform.can_see_club(p_club) or not platform.club_editable(p_club) then
    raise exception 'connection_check:forbidden' using errcode = 'P0001';
  end if;
  if p_check is null or p_check not in ('line_token', 'beam_keys', 'beam_charge') then
    raise exception 'connection_check:invalid' using errcode = 'P0001';
  end if;
  if p_reason is not null and p_reason !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'connection_check:invalid' using errcode = 'P0001';
  end if;
  insert into platform.club_health as h (club_id, check_key, status, reason, changed_at, checked_at)
  values (p_club, p_check, v_status, p_reason, app.now(), app.now())
  on conflict (club_id, check_key) do update
    set status = excluded.status,
        reason = excluded.reason,
        changed_at = case when h.status is distinct from excluded.status then app.now() else h.changed_at end,
        checked_at = app.now();
end $$;
alter function platform.record_connection_check(uuid, text, text) owner to booq_owner;
revoke all on function platform.record_connection_check(uuid, text, text) from public;
grant execute on function platform.record_connection_check(uuid, text, text) to booq_platform;
