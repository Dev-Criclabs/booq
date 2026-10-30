-- F05-T04c / migration 0699: the Beam checks in platform.club_health, so a P1 alert of the payment code shows on the
-- console health tile (PAY-01-AC7, PAY-02-AC5; decision D75; F05 design 5.1, 5.11). Built by BE-C on the
-- orchestrator's instruction of 30 Oct. A D159 exception: it redefines the check_key CHECK of F10's 0604, so it is
-- numbered above it (docs/architecture/build-plan.md section 4).
--   * check keys beam_keys (the club's key set: missing or refused by Beam) and beam_charge (creating a charge:
--     Beam unreachable, or the platform QR margin unset). F10's line_token and line_usage are unchanged.
--   * app.report_payment_health(check, reason): failed with a reason code, or ok when reason is null. changed_at
--     moves only when the status changes; checked_at every time. Club from app.club_id(); the caller is a person
--     of the club (the Pay route acts for the player) or the worker. Codes only: no person, amount or key.

alter table platform.club_health drop constraint club_health_check_values;
alter table platform.club_health add constraint club_health_check_values
  check (check_key in ('line_token', 'line_usage', 'beam_keys', 'beam_charge'));

create function app.report_payment_health(p_check text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_status text := case when p_reason is null then 'ok' else 'failed' end;
begin
  if v_club is null then
    raise exception 'report_payment_health needs a club in the context' using errcode = 'P0001';
  end if;
  if app.user_id() is null and coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'report_payment_health: not allowed' using errcode = '42501';
  end if;
  if p_check is null or p_check not in ('beam_keys', 'beam_charge') then
    raise exception 'report_payment_health: unknown check' using errcode = '22023';
  end if;
  if p_reason is not null and not (
       (p_check = 'beam_keys' and p_reason in ('keys_missing', 'key_refused'))
    or (p_check = 'beam_charge' and p_reason in ('unreachable', 'margin_unset'))) then
    raise exception 'report_payment_health: unknown reason' using errcode = '22023';
  end if;
  insert into platform.club_health as h (club_id, check_key, status, reason, changed_at, checked_at)
  values (v_club, p_check, v_status, p_reason, app.now(), app.now())
  on conflict (club_id, check_key) do update
    set status = excluded.status,
        reason = excluded.reason,
        changed_at = case when h.status is distinct from excluded.status then excluded.changed_at else h.changed_at end,
        checked_at = excluded.checked_at;
end $$;
alter function app.report_payment_health(text, text) owner to booq_owner;
revoke all on function app.report_payment_health(text, text) from public;
grant execute on function app.report_payment_health(text, text) to booq_app, booq_worker;
