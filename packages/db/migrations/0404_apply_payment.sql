-- F05-T05a / migration 0404: app.apply_payment, part (a), and the ports to F06 and F13.
-- Requirements: PAY-02-AC4, AC7, PAY-03-AC7; decisions D18, D25. Design: docs/architecture/apply-payment.md.
-- Part (a) handles a repeated callback, success while the hold runs, and success after the hold when the slot is
-- still open. Every other case raises payment:wallet_path_not_built until parts (b) and (c) (0405, 0406) replace
-- this function, so nothing is ever half applied.
--
-- Ports: F06 (credit, wallet, packages) and F13 (receipts) do not exist yet. apply_payment calls them through
-- app.payment_ports, filled by the migration of the feature that owns the port (like app.release_handlers). A port
-- that is not registered raises payment:port_missing:<port> and rolls the whole call back: a payment is never
-- confirmed with a step silently skipped.
--   reserve_credit_and_wallet(order uuid) returns boolean      F06  re-reserve the credits and wallet of the order
--   grant_package(order uuid) returns void                     F06  create the package of a paid package order
--   credit_wallet(order_kind text, customer uuid, amount_satang integer, reason text, dedupe_key text, payment uuid)
--                 returns uuid                                 F06  wallet movement and its wallet_credit order
--   issue_receipt(order uuid, payment uuid, kind text) returns uuid   F13  the receipt for money received

create table app.payment_ports (
  port text primary key check (port in ('reserve_credit_and_wallet', 'grant_package', 'credit_wallet', 'issue_receipt')),
  handler regprocedure not null
);
alter table app.payment_ports owner to booq_owner;
revoke all on app.payment_ports from public;

create function app.register_payment_port(p_port text, p_handler regprocedure) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ insert into app.payment_ports (port, handler) values (p_port, p_handler) $$;
alter function app.register_payment_port(text, regprocedure) owner to booq_owner;
revoke all on function app.register_payment_port(text, regprocedure) from public;

-- The handler of a port, or an error when it is missing.
create function app.port_of(p_port text) returns regproc
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare v_handler regprocedure;
begin
  select h.handler into v_handler from app.payment_ports h where h.port = p_port;
  if v_handler is null then
    raise exception 'payment:port_missing:%', p_port using errcode = 'P0001';
  end if;
  return v_handler::regproc;
end $$;
alter function app.port_of(text) owner to booq_owner;
revoke all on function app.port_of(text) from public;

create function app.apply_payment(p_payment uuid, p_received_satang integer) returns jsonb
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
      when sqlstate 'BK001' then            -- slot_unavailable, club_paused: part (b) sends the value to the wallet
        raise exception 'payment:wallet_path_not_built' using errcode = 'P0001';
      when others then
        if sqlerrm like 'payment:cannot_%' then
          raise exception 'payment:wallet_path_not_built' using errcode = 'P0001';
        end if;
        raise;
    end;
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
