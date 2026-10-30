-- F05-T08a-db / migration 0414: what the Beam webhook needs from the database (PAY-02-AC4 to AC15; decisions D24, D71, D72, D75). F05 design 5.
--   app.club_by_beam_webhook(token_hash)  the one lookup that runs before any club is known (as app.club_by_line_webhook, 0049):
--       {club_id, key_set: 'test'|'live', merchant_id} for the payment_connection whose test or live webhook token hash matches, or
--       null. It answers nothing else, so the worker needs no read access to payment_connection. Granted to booq_app and booq_worker.
--   app.record_payment_event(charge_id, event_type, body_hash, signature_ok, outcome, payment, looked_up)  worker only, club from
--       app.club_id(). Inserts the callback log row ON CONFLICT (club_id, gateway, gateway_charge_id, event_type) DO NOTHING and
--       returns its id, or null for a duplicate (D24). looked_up {status, amount_satang, reference} fills the looked_up_* columns.
--       is_test follows the club status (the trigger of 0402). Decision D147: a call with a bad signature writes NO row: the row
--       would take the dedupe key and block the real event; the evidence is the P1 alert and a club_health row, written by the server.
--   app.fail_payment(payment, failure_code)  worker only. A charge Beam reports failed: status failed, failure_code set, QR cleared,
--       guarded by status = 'pending' (a final payment is left alone). It does not release the hold: the player may tap again
--       inside it and gets a new charge (D72).
--   payment_event_outcome_values gains 'failed' for a lookup that says the charge failed. Rule D159: redefines the constraint of 0402.

alter table public.payment_event drop constraint payment_event_outcome_values;
alter table public.payment_event add constraint payment_event_outcome_values check (outcome in
  ('applied', 'applied_late', 'wallet_late', 'wallet_duplicate', 'wallet_cancelled', 'wallet_wrong_amount', 'mismatch',
   'unknown_charge', 'ignored', 'duplicate', 'bad_signature', 'lookup_failed', 'failed'));

create function app.club_by_beam_webhook(p_token_hash text) returns jsonb
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select case
           when c.webhook_token_hash_test = p_token_hash then jsonb_build_object('club_id', c.club_id, 'key_set', 'test', 'merchant_id', c.merchant_id_test)
           else jsonb_build_object('club_id', c.club_id, 'key_set', 'live', 'merchant_id', c.merchant_id_live)
         end
    from public.payment_connection c
   where p_token_hash is not null and p_token_hash <> '' and (c.webhook_token_hash_test = p_token_hash or c.webhook_token_hash_live = p_token_hash)
   limit 1
$$;
alter function app.club_by_beam_webhook(text) owner to booq_owner;
revoke all on function app.club_by_beam_webhook(text) from public;
grant execute on function app.club_by_beam_webhook(text) to booq_app, booq_worker;

create function app.record_payment_event(
  p_charge_id text, p_event_type text, p_body_hash text, p_signature_ok boolean, p_outcome text,
  p_payment uuid default null, p_looked_up jsonb default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_id uuid;
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not coalesce(p_signature_ok, false) then
    return null;                                   -- no row for a bad signature (D147): it would block the real event
  end if;
  if p_looked_up is not null and jsonb_typeof(p_looked_up) <> 'object' then
    raise exception 'payment_event: invalid lookup' using errcode = 'P0001';
  end if;
  begin
    insert into public.payment_event (club_id, gateway, gateway_charge_id, event_type, body_hash, signature_ok, looked_up_status,
                                      looked_up_amount_satang, looked_up_reference, outcome, payment_id)
    values (v_club, 'beam', p_charge_id, p_event_type, p_body_hash, true, p_looked_up ->> 'status',
            (p_looked_up ->> 'amount_satang')::integer, p_looked_up ->> 'reference', p_outcome, p_payment)
    on conflict (club_id, gateway, gateway_charge_id, event_type) do nothing
    returning id into v_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation or foreign_key_violation then
    raise exception 'payment_event: invalid event (%)', sqlerrm using errcode = 'P0001';
  end;
  return v_id;
end $$;
alter function app.record_payment_event(text, text, text, boolean, text, uuid, jsonb) owner to booq_owner;
revoke all on function app.record_payment_event(text, text, text, boolean, text, uuid, jsonb) from public;
grant execute on function app.record_payment_event(text, text, text, boolean, text, uuid, jsonb) to booq_worker;

create function app.fail_payment(p_payment uuid, p_failure_code text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_failure_code, '')), '') is null then
    raise exception 'payment: a failure code is required' using errcode = 'P0001';
  end if;
  update public.payment set status = 'failed', failure_code = p_failure_code, qr_image = null
   where club_id = v_club and id = p_payment and method = 'beam' and status = 'pending';
end $$;
alter function app.fail_payment(uuid, text) owner to booq_owner;
revoke all on function app.fail_payment(uuid, text) from public;
grant execute on function app.fail_payment(uuid, text) to booq_worker;
