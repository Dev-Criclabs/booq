-- F07-T06b / migration 0809: the order that adds a coach to a booking goes through the payment path (COACH-03-AC3, D74, D111).
-- Redefines app.apply_payment (last defined by 0410; rule D159, so numbered above it): when the order has a
-- booking_coach_add row (0806), payment confirms the add while its hold runs (app.confirm_coach_add); when the hold has
-- ended or the add was released, app.reclaim_coach_add takes the coach back if the coach is still free, and when not (or
-- the account is deleted) the whole amount goes to the wallet with the outcome wallet_late, the booking staying a court
-- booking. Every other order is handled exactly as 0410 did.

create function app.reclaim_coach_add(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  a public.booking_coach_add%rowtype;
  b public.booking%rowtype;
begin
  if v_club is null then
    raise exception 'reclaim_coach_add needs a club in the context' using errcode = 'P0001';
  end if;
  select * into a from public.booking_coach_add where club_id = v_club and order_id = p_order for update;
  if not found or a.status <> 'released' then
    return false;
  end if;
  perform app.lock_coach(a.coach_id);
  select * into b from public.booking where club_id = v_club and id = a.booking_id for update;
  if b.status <> 'confirmed' or b.type <> 'court' or b.coach_id is not null or b.start_at <= app.now()
     or app.coach_check(v_club, a.coach_id, array[b.start_at], a.booking_id) is not null
     or exists (select 1 from public.booking_coach_add x where x.club_id = v_club and x.booking_id = a.booking_id and x.status in ('pending', 'confirmed')) then
    return false;
  end if;
  begin
    update public.occupancy set coach_id = a.coach_id, kind = 'solo_class' where club_id = v_club and booking_id = a.booking_id;
    update public.booking set coach_id = a.coach_id, type = 'solo_class', updated_at = app.now() where club_id = v_club and id = a.booking_id;
    update public.booking_coach_add set status = 'confirmed', hold_expires_at = null where club_id = v_club and order_id = p_order;
  exception when exclusion_violation then
    return false;
  end;
  return true;
end $$;
alter function app.reclaim_coach_add(uuid) owner to booq_owner;
revoke all on function app.reclaim_coach_add(uuid) from public;

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
  v_add public.booking_coach_add%rowtype;
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

  select * into v_add from public.booking_coach_add where club_id = v_club and order_id = v_order;
  if v_add.order_id is not null then
    -- The order that adds a coach to a booking (F07 5.5, D111): the coach was claimed on the booking when the order was made.
    if v_add.status = 'pending' and v_add.hold_expires_at > app.now() and app.confirm_coach_add(v_order) then
      v_outcome := 'applied';
    else
      -- The hold ended or was released: take the coach back if still free, else the money goes to the wallet (D74).
      perform app.release_coach_add(v_order, 'expired');
      if exists (select 1 from public.app_user u where u.club_id = v_club and u.id = o.customer_id and u.anonymised_at is not null)
         or not app.reclaim_coach_add(v_order) then
        return app.pay_to_wallet(p_payment, v_order, 'wallet_late', 'late_payment');
      end if;
      v_outcome := 'applied_late';
    end if;
  elsif not v_has_bookings then
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
