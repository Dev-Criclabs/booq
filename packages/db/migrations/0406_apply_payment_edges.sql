-- F05-T05c / migration 0406: app.apply_payment, part (c): money that arrives for something that can no longer take it.
-- Requirements: PAY-03, PAY-04-AC7; decisions D74, D107, D109. Design: docs/architecture/apply-payment.md.
--   * a Beam success on a payment that cash already cancelled (the guard that accepts it): wallet_cancelled
--   * a second success for an order already paid: wallet_duplicate, reason duplicate_payment
--   * a success for a cancelled order, a cancelled package order included: wallet_cancelled, reason late_payment
--   * a late success when the customer's account was deleted (anonymised): wallet_late
--   * a Paused club was already covered in part (b) through reclaim_order.
-- All use one helper, app.pay_to_wallet (wallet credit and its own receipt, once, order status unchanged).
-- Nothing in apply_payment raises wallet_path_not_built any more.

-- The guard that accepts a Beam success on a payment cash already cancelled (PAY-04-AC7): a cancelled payment is
-- final except for that one move, to succeeded with outcome wallet_cancelled and the confirmation time. Money
-- really arrived at Beam, so the record must say so; the order is not touched.
create or replace function app.keep_payment_identity() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if new.club_id <> old.club_id or new.order_id <> old.order_id or new.method <> old.method
     or new.amount_satang <> old.amount_satang or new.environment is distinct from old.environment
     or new.gateway is distinct from old.gateway or new.created_at <> old.created_at then
    raise exception 'a payment''s order, method, amount and key set do not change' using errcode = 'P0001';
  end if;
  if old.status in ('succeeded', 'failed', 'cancelled') and new.status <> old.status
     and not (old.status = 'cancelled' and old.method = 'beam' and new.status = 'succeeded' and new.outcome = 'wallet_cancelled') then
    raise exception 'a % payment is final', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Money received that cannot confirm anything: the payment is succeeded with its outcome, the whole amount goes to
-- the wallet through the F06 port (once: dedupe key late_payment:{payment}) and the F13 port issues the receipt for the
-- money received (D37). The order keeps its status. Internal: only apply_payment calls it.
create function app.pay_to_wallet(p_payment uuid, p_order uuid, p_outcome text, p_reason text) returns jsonb
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
  v_wallet boolean := false;
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

  if not v_has_bookings then
    v_outcome := 'applied';                  -- a package order has no hour to confirm
  elsif app.confirm_booking(v_order) then    -- success while the hold runs
    v_outcome := 'applied';
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
      if o.credit_value_satang > 0 or o.wallet_satang > 0 then
        execute format('select %s($1)', app.port_of('reserve_credit_and_wallet')) into v_ok using v_order;
        if not coalesce(v_ok, false) then
          raise exception 'payment:cannot_reserve' using errcode = 'P0001';
        end if;
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

  update public.orders set status = 'paid' where club_id = v_club and id = v_order;
  update public.payment set status = 'succeeded', outcome = v_outcome, confirmed_at = app.now(), qr_image = null
   where club_id = v_club and id = p_payment;
  if exists (select 1 from public.order_line l where l.club_id = v_club and l.order_id = v_order and l.kind = 'package') then
    execute format('select %s($1)', app.port_of('grant_package')) using v_order;
  end if;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) using v_order, p_payment, 'order';
  return jsonb_build_object('outcome', v_outcome, 'order_status', 'paid');
end $$;
alter function app.apply_payment(uuid, integer) owner to booq_owner;
revoke all on function app.apply_payment(uuid, integer) from public;
grant execute on function app.apply_payment(uuid, integer) to booq_worker;
