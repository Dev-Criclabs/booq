-- F05-T08c / migration 0799: the Beam webhook's own check on the console health tile (PAY-02-AC5, AC9, AC14; D71, D75).
-- A D159 exception: it redefines club_health's check_key CHECK and app.report_payment_health, last defined in 0699,
-- so it is numbered above it; 0799 is reserved for it at the top of F13's block (orchestrator, 31 Oct).
--   * check key beam_webhook, reasons bad_signature (a call on the club's webhook URL whose signature does not verify,
--     D24) and unknown_charge (a validly signed callback for a charge BOOQ does not know, D71). Codes only.
--   * app.report_payment_health accepts the new check; everything else is 0699's.

alter table platform.club_health drop constraint club_health_check_values;
alter table platform.club_health add constraint club_health_check_values
  check (check_key in ('line_token', 'line_usage', 'beam_keys', 'beam_charge', 'beam_webhook'));

create or replace function app.report_payment_health(p_check text, p_reason text) returns void
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
  if p_check is null or p_check not in ('beam_keys', 'beam_charge', 'beam_webhook') then
    raise exception 'report_payment_health: unknown check' using errcode = '22023';
  end if;
  if p_reason is not null and not (
       (p_check = 'beam_keys' and p_reason in ('keys_missing', 'key_refused'))
    or (p_check = 'beam_charge' and p_reason in ('unreachable', 'margin_unset'))
    or (p_check = 'beam_webhook' and p_reason in ('bad_signature', 'unknown_charge'))) then
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
