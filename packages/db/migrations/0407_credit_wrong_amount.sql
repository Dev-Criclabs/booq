-- F05-T06 / migration 0407: a validly signed payment of the wrong amount (PAY-02-AC6; D24, D77, D79; design 5.5).
-- The booking is not confirmed and the player's money is not lost: app.flag_wrong_amount (the worker, from the
-- webhook decision) records what Beam says it received and opens one owner flag; app.credit_wrong_amount (front desk
-- or owner, with a reason) then credits the FULL amount received, underpayment or overpayment, to the wallet through
-- the F06 port with its own receipt through the F13 port, closes the payment as wallet_wrong_amount, resolves the
-- flag and writes the audit entry (who and why; the reason text is kept as personal data). It is a wallet credit,
-- never a refund to Beam (PAY-05-AC4). Ports fail closed (docs/architecture/apply-payment.md).
alter table public.payment add column received_satang integer check (received_satang is null or received_satang > 0);

create function app.flag_wrong_amount(p_payment uuid, p_received_satang integer) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.payment%rowtype;
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into p from public.payment where club_id = v_club and id = p_payment for update;
  if not found or p.method <> 'beam' then
    raise exception 'payment:not_found' using errcode = 'P0001';
  end if;
  if p_received_satang is null or p_received_satang < 1 or p_received_satang = p.amount_satang then
    raise exception 'payment:not a wrong amount' using errcode = 'P0001';
  end if;
  if p.status not in ('pending', 'expired') then
    return;                                 -- already settled one way or the other: nothing to flag
  end if;
  update public.payment set outcome = 'mismatch', received_satang = coalesce(received_satang, p_received_satang)
   where club_id = v_club and id = p_payment;
  insert into public.owner_flag (club_id, kind, payment_id, is_test)
    values (v_club, 'wrong_amount', p_payment, p.is_test)
    on conflict do nothing;                 -- one open flag per payment: a repeated callback does not pile up
end $$;

create function app.credit_wrong_amount(p_payment uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  o public.orders%rowtype;
  p public.payment%rowtype;
  v_wallet_order uuid;
begin
  if v_club is null then
    raise exception 'credit_wrong_amount needs a club in the context' using errcode = 'P0001';
  end if;
  if v_user is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'payment: not allowed' using errcode = '42501';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'payment: a reason is required' using errcode = 'P0001';
  end if;
  select * into p from public.payment where club_id = v_club and id = p_payment for update;
  if not found then
    raise exception 'payment:not_found' using errcode = 'P0001';
  end if;
  if p.method <> 'beam' or p.status not in ('pending', 'expired') or p.outcome is distinct from 'mismatch' or p.received_satang is null
     or not exists (select 1 from public.owner_flag f where f.club_id = v_club and f.payment_id = p_payment and f.kind = 'wrong_amount' and f.status = 'open') then
    raise exception 'payment: not a wrong amount payment waiting for a credit' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p.order_id;

  execute format('select %s($1, $2, $3, $4, $5, $6)', app.port_of('credit_wallet'))
    into v_wallet_order using 'wallet_credit', o.customer_id, p.received_satang, 'wrong_amount', 'wrong_amount:' || p_payment::text, p_payment;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) using v_wallet_order, p_payment, 'wallet_credit';
  update public.payment set status = 'succeeded', outcome = 'wallet_wrong_amount', confirmed_at = app.now(), qr_image = null
   where club_id = v_club and id = p_payment;
  update public.owner_flag set status = 'resolved', resolved_by = v_user, resolved_at = app.now(), note = btrim(p_note)
   where club_id = v_club and payment_id = p_payment and kind = 'wrong_amount' and status = 'open';
  execute format('select %s($1, $2, $3, $4, $5)', app.port_of('enqueue_message'))
    using 'wrong_amount', o.customer_id, jsonb_build_object('payment_id', p_payment, 'amount_satang', p.received_satang), 'wrong_amount:' || p_payment::text, app.now();
  perform audit.note('payment.wrong_amount_credited', 'payment', p_payment,
                     jsonb_build_object('received_satang', p.received_satang, 'expected_satang', p.amount_satang),
                     jsonb_build_object('note', btrim(p_note)));
  return jsonb_build_object('outcome', 'wallet_wrong_amount', 'amount_satang', p.received_satang, 'wallet_order', v_wallet_order);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.flag_wrong_amount(uuid, integer)', 'app.credit_wrong_amount(uuid, text)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
  grant execute on function app.flag_wrong_amount(uuid, integer) to booq_worker;
  grant execute on function app.credit_wrong_amount(uuid, text) to booq_app;
end $$;
