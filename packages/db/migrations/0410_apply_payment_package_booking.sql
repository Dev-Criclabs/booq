-- F05 / migration 0410: apply_payment for a package bought with a booking, and the fifth port enqueue_message.
-- Review F06 F10 F13 (docs/architecture/review-F06-F10-F13.md), accepted by the orchestrator (D147).
--   * Package with a booking (F06 4.4, flows H and I): with the hold running the order is granted, its credits and
--     wallet are reserved (the credit that covers the booked hour comes from the package just granted), and only then
--     is the booking confirmed, in one sub-block. When the reserve or the confirmation cannot be done nothing is
--     left half created (R3-AC7, D87): the sub-block is undone, the hold is released with the reason
--     payment_unavailable (F10 sends no "released" message for it) and the whole amount goes to the wallet.
--     The late path does the same after the slot is taken back: reclaim, re-apply the code and birthday, grant,
--     reserve. A grant that raises (payment:grant:*) is not caught: the payment stays pending and is retried.
--   * enqueue_message(kind, user, params, dedupe_key, send_at) returns uuid is the fifth port, registered by F10
--     (0605). booking_confirmed (dedupe confirmed:{order}) after applied and applied_late for an order with
--     hours; late_payment (dedupe late:{payment}) after every wallet outcome. Params are ids and values only.

alter table app.payment_ports drop constraint payment_ports_port_check;
alter table app.payment_ports add constraint payment_ports_port_check
  check (port in ('reserve_credit_and_wallet', 'grant_package', 'credit_wallet', 'issue_receipt', 'enqueue_message'));

create or replace function app.pay_to_wallet(p_payment uuid, p_order uuid, p_outcome text, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  p public.payment%rowtype;
  v_wallet_order uuid;
begin
  select * into o from public.orders where club_id = v_club and id = p_order;
  select * into p from public.payment where club_id = v_club and id = p_payment;
  update public.payment set status = 'succeeded', outcome = p_outcome, confirmed_at = app.now(), qr_image = null
   where club_id = v_club and id = p_payment;
  execute format('select %s($1, $2, $3, $4, $5, $6)', app.port_of('credit_wallet'))
    into v_wallet_order using 'wallet_credit', o.customer_id, p.amount_satang, p_reason, 'late_payment:' || p_payment::text, p_payment;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) using v_wallet_order, p_payment, 'wallet_credit';
  -- The player is told what happened (PAY-03-AC2 to AC4, AC6): F10 sends 'late_payment' once per payment.
  execute format('select %s($1, $2, $3, $4, $5)', app.port_of('enqueue_message'))
    using 'late_payment', o.customer_id, jsonb_build_object('payment_id', p_payment, 'outcome', p_outcome, 'amount_satang', p.amount_satang), 'late:' || p_payment::text, app.now();
  return jsonb_build_object('outcome', p_outcome, 'order_status', o.status, 'wallet_order', v_wallet_order);
end $$;
alter function app.pay_to_wallet(uuid, uuid, text, text) owner to booq_owner;
revoke all on function app.pay_to_wallet(uuid, uuid, text, text) from public;

create or replace function app.apply_payment(p_payment uuid, p_received_satang integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_order uuid;
  o public.orders%rowtype;
  p public.payment%rowtype;
  v_outcome text;
  v_ok boolean;
  v_has_bookings boolean;
  v_has_package boolean;
  v_alloc boolean;
  v_wallet boolean := false;
  v_running boolean;
  v_result jsonb;
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select order_id into v_order from public.payment where club_id = v_club and id = p_payment;
  if v_order is null then
    raise exception 'payment:not_found' using errcode = 'P0001';
  end if;
  -- Lock order: the order, then (in the booking functions) its bookings, then the payment (FA 3.4).
  select * into o from public.orders where club_id = v_club and id = v_order for update;
  select * into p from public.payment where club_id = v_club and id = p_payment for update;
  if p.method <> 'beam' then
    raise exception 'payment:not_beam' using errcode = 'P0001';
  end if;
  if p_received_satang is distinct from p.amount_satang then
    raise exception 'payment:amount_mismatch' using errcode = 'P0001';   -- a wrong amount is the caller's owner flag, never here
  end if;

  -- A repeated callback changes nothing.
  if p.status = 'succeeded' then
    return jsonb_build_object('outcome', p.outcome, 'order_status', o.status, 'repeated', true);
  end if;
  -- Money that arrives for something that can no longer take it goes to the wallet with its own receipt (D74, D107).
  if p.status = 'cancelled' then
    return app.pay_to_wallet(p_payment, v_order, 'wallet_cancelled', 'late_payment');       -- cash already settled the order
  elsif o.status = 'paid' then
    return app.pay_to_wallet(p_payment, v_order, 'wallet_duplicate', 'duplicate_payment');  -- a second success
  elsif o.status = 'cancelled' then
    return app.pay_to_wallet(p_payment, v_order, 'wallet_cancelled', 'late_payment');       -- a cancelled order, package orders included
  end if;

  select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = v_order) into v_has_bookings;
  select exists (select 1 from public.order_line l where l.club_id = v_club and l.order_id = v_order and l.kind = 'package') into v_has_package;
  v_alloc := o.credit_value_satang > 0 or o.wallet_satang > 0;

  if not v_has_bookings then
    v_outcome := 'applied';                       -- a package order has no hour to confirm
    if v_has_package then
      execute format('select %s($1)', app.port_of('grant_package')) using v_order;
    end if;
  else
    select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = v_order
                    and b.status = 'awaiting_payment' and b.hold_expires_at > app.now()) into v_running;
    if v_running then
      -- Success while the hold runs. For a package bought with the booking, grant and reserve come before the confirmation.
      begin
        if v_has_package then
          execute format('select %s($1)', app.port_of('grant_package')) using v_order;
          if v_alloc then
            execute format('select %s($1)', app.port_of('reserve_credit_and_wallet')) into v_ok using v_order;
            if not coalesce(v_ok, false) then raise exception 'payment:cannot_reserve' using errcode = 'P0001'; end if;
          end if;
        end if;
        if not app.confirm_booking(v_order) then
          raise exception 'payment:cannot_confirm' using errcode = 'P0001';
        end if;
        v_outcome := 'applied';
      exception when others then
        if sqlerrm like 'payment:cannot_%' then v_wallet := true; else raise; end if;
      end;
      if v_wallet then
        -- The payment becomes succeeded first, so the release handler of payment_unavailable (which fails pending
        -- payments) leaves it alone. The paid hold cannot be kept; no "released" message is sent for this reason.
        v_result := app.pay_to_wallet(p_payment, v_order, 'wallet_late', 'late_payment');
        perform app.release_hold(v_order, 'payment_unavailable');
        return v_result;
      end if;
    else
      -- The hold ended. If the job has not released it yet, release it now, then try to take the slot back.
      perform app.release_hold(v_order, 'expired');
      -- A deleted account never gets a booking back from a late payment (D107).
      if exists (select 1 from public.app_user u where u.club_id = v_club and u.id = o.customer_id and u.anonymised_at is not null) then
        return app.pay_to_wallet(p_payment, v_order, 'wallet_late', 'late_payment');
      end if;
      begin
        if not app.reclaim_order(v_order) then
          raise exception 'payment:cannot_reclaim' using errcode = 'P0001';
        end if;
        if not coalesce((app.reapply_order_entitlements(v_order) ->> 'ok')::boolean, false) then
          raise exception 'payment:cannot_reapply' using errcode = 'P0001';
        end if;
        if v_has_package then
          execute format('select %s($1)', app.port_of('grant_package')) using v_order;
        end if;
        if v_alloc then
          execute format('select %s($1)', app.port_of('reserve_credit_and_wallet')) into v_ok using v_order;
          if not coalesce(v_ok, false) then raise exception 'payment:cannot_reserve' using errcode = 'P0001'; end if;
        end if;
        v_outcome := 'applied_late';
      exception
        when sqlstate 'BK001' then v_wallet := true;       -- slot_unavailable, club_paused: the sub-block is undone
        when others then
          if sqlerrm like 'payment:cannot_%' then v_wallet := true; else raise; end if;
      end;
      if v_wallet then
        return app.pay_to_wallet(p_payment, v_order, 'wallet_late', 'late_payment');
      end if;
    end if;
  end if;

  update public.orders set status = 'paid' where club_id = v_club and id = v_order;
  update public.payment set status = 'succeeded', outcome = v_outcome, confirmed_at = app.now(), qr_image = null
   where club_id = v_club and id = p_payment;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) using v_order, p_payment, 'order';
  if v_has_bookings then
    execute format('select %s($1, $2, $3, $4, $5)', app.port_of('enqueue_message'))
      using 'booking_confirmed', o.customer_id, jsonb_build_object('order_id', v_order), 'confirmed:' || v_order::text, app.now();
  end if;
  return jsonb_build_object('outcome', v_outcome, 'order_status', 'paid');
end $$;
alter function app.apply_payment(uuid, integer) owner to booq_owner;
revoke all on function app.apply_payment(uuid, integer) from public;
grant execute on function app.apply_payment(uuid, integer) to booq_worker;
