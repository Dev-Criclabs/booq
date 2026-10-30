-- F05-T07 / migration 0408: cash at the front desk (PAY-06-AC1 to AC5; decision D56; design 5.6).
-- app.take_cash(order, reason code, note): front desk or owner only (payment.cash). The reason code is one of
-- no_banking_app, qr_failed_at_counter, other; "other" needs a note (the table CHECK says the same). In one
-- transaction: the order's pending Beam payment is cancelled (a late Beam success then follows the wallet rule, 0406);
-- a succeeded cash payment for exactly the money due is recorded with the staff member; the order is confirmed the
-- way a Beam success confirms it (a package order is granted, one bought with a booking grants, reserves, then
-- confirms; this path cannot fall back to the wallet, so a failure raises and nothing is kept); the order is paid;
-- the F13 receipt and the confirmation message go out through the ports; the audit entry names the reason code.
-- The staff note is free text about a customer, so it is personal data: it is a pii column of the payment audit
-- registration and the take_cash entry keeps it apart. A cash order cancelled 12 hours or more ahead returns value to
-- the wallet, never as cash (F09, PAY-06-AC7).
update audit.registry set pii_columns = array['cash_reason_note']
 where table_schema = 'public' and table_name = 'payment';

create function app.take_cash(p_order uuid, p_reason_code text, p_note text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  o public.orders%rowtype;
  v_has_bookings boolean;
  v_has_package boolean;
  v_alloc boolean;
  v_ok boolean;
  v_payment uuid;
begin
  if v_club is null then
    raise exception 'take_cash needs a club in the context' using errcode = 'P0001';
  end if;
  if v_user is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'payment: not allowed' using errcode = '42501';
  end if;
  if p_reason_code is null or p_reason_code not in ('no_banking_app', 'qr_failed_at_counter', 'other') then
    raise exception 'payment: unknown cash reason code' using errcode = 'P0001';
  end if;
  if p_reason_code = 'other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'payment: a note is required for the reason other' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or o.status <> 'open' then
    raise exception 'payment: no open order' using errcode = 'P0001';
  end if;
  if o.priced_at is null or o.money_satang < 1 then
    raise exception 'payment: nothing to pay in cash' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order) into v_has_bookings;
  if v_has_bookings and not exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order
                                     and b.status = 'awaiting_payment' and b.hold_expires_at > app.now()) then
    raise exception 'payment: the hold is not running' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.order_line l where l.club_id = v_club and l.order_id = p_order and l.kind = 'package') into v_has_package;
  v_alloc := o.credit_value_satang > 0 or o.wallet_satang > 0;

  update public.payment set status = 'cancelled'
   where club_id = v_club and order_id = p_order and method = 'beam' and status = 'pending';
  insert into public.payment (club_id, order_id, method, status, amount_satang, cash_reason_code, cash_reason_note, taken_by, confirmed_at, outcome, is_test)
    values (v_club, p_order, 'cash', 'succeeded', o.money_satang, p_reason_code, nullif(btrim(coalesce(p_note, '')), ''), v_user, app.now(), 'applied', o.is_test)
    returning id into v_payment;

  if v_has_package then
    execute format('select %s($1)', app.port_of('grant_package')) using p_order;
  end if;
  if v_has_bookings then
    if v_has_package and v_alloc then
      execute format('select %s($1)', app.port_of('reserve_credit_and_wallet')) into v_ok using p_order;
      if not coalesce(v_ok, false) then raise exception 'payment: the credits cannot be reserved' using errcode = 'P0001'; end if;
    end if;
    if not app.confirm_booking(p_order) then
      raise exception 'payment: the booking cannot be confirmed' using errcode = 'P0001';
    end if;
  end if;
  update public.orders set status = 'paid' where club_id = v_club and id = p_order;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) using p_order, v_payment, 'order';
  if v_has_bookings then
    execute format('select %s($1, $2, $3, $4, $5)', app.port_of('enqueue_message'))
      using 'booking_confirmed', o.customer_id, jsonb_build_object('order_id', p_order), 'confirmed:' || p_order::text, app.now();
  end if;
  perform audit.note('payment.cash_taken', 'payment', v_payment,
                     jsonb_build_object('reason_code', p_reason_code, 'amount_satang', o.money_satang),
                     case when nullif(btrim(coalesce(p_note, '')), '') is null then null else jsonb_build_object('note', btrim(p_note)) end);
  return jsonb_build_object('outcome', 'applied', 'order_status', 'paid', 'payment_id', v_payment);
end $$;
alter function app.take_cash(uuid, text, text) owner to booq_owner;
revoke all on function app.take_cash(uuid, text, text) from public;
grant execute on function app.take_cash(uuid, text, text) to booq_app;
