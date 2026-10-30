-- F05-T05b / migration 0405: app.apply_payment, part (b): a late payment that cannot take its slot back goes to
-- the wallet. Requirements: PAY-03-AC1 to AC5; decisions D25, D37, D48. Design: docs/architecture/apply-payment.md.
-- The hold ended and: another hold, booking or closure holds the slot (a solo class needs court and coach both
-- free), or the code or birthday entitlement cannot be re-applied, or the credits and wallet cannot be re-reserved,
-- or the club is Paused (reclaim_order refuses). The sub-block that tried to take the slot is undone, the payment
-- is succeeded with outcome wallet_late, the whole amount goes to the wallet (reason late_payment) with its own
-- receipt, in one transaction with the dedupe key late_payment:{payment}; the order keeps its status (released).
-- Still raising until part (c): a cancelled payment, a paid or cancelled order, a deleted account.

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
  v_wallet_order uuid;
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
  if p.status = 'cancelled' or o.status not in ('open', 'released') then
    raise exception 'payment:wallet_path_not_built' using errcode = 'P0001';
  end if;

  select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = v_order) into v_has_bookings;

  if not v_has_bookings then
    v_outcome := 'applied';                  -- a package order has no hour to confirm
  elsif app.confirm_booking(v_order) then    -- success while the hold runs
    v_outcome := 'applied';
  else
    -- The hold ended. If the job has not released it yet, release it now, then try to take the slot back.
    perform app.release_hold(v_order, 'expired');
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
      -- The slot is not open or the value cannot be re-applied: the whole amount goes to the wallet with its own
      -- receipt, in this transaction, once (dedupe key late_payment:{payment}); the order keeps its status.
      v_outcome := 'wallet_late';
      update public.payment set status = 'succeeded', outcome = v_outcome, confirmed_at = app.now(), qr_image = null
       where club_id = v_club and id = p_payment;
      execute format('select %s($1, $2, $3, $4, $5, $6)', app.port_of('credit_wallet'))
        into v_wallet_order using 'wallet_credit', o.customer_id, p.amount_satang, 'late_payment', 'late_payment:' || p_payment::text, p_payment;
      execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) using v_wallet_order, p_payment, 'wallet_credit';
      return jsonb_build_object('outcome', v_outcome, 'order_status', (select status from public.orders where club_id = v_club and id = v_order), 'wallet_order', v_wallet_order);
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
