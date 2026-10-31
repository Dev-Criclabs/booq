-- F05 package-only Pay / migration 0416: a package bought on its own (PAY-04-AC1 to AC4; F06 R3-AC1, AC4; D74; F05 design
-- 5.2). Built by BE-C on the orchestrator's instruction of 31 Oct. Numbered above the last definition of each object it
-- redefines (D159): app.start_payment (0403), app.payment_charge_context (0412), F04's app.complete_zero_money_order
-- (0319) and app.expire_package_order (0415).
--   * app.start_payment: an order with no bookings (a package bought alone) needs no running hold; an order with bookings
--     still does (D18). Everything else is 0403's.
--   * app.payment_charge_context also returns has_bookings and package_qr_minutes, the club setting that is the QR life of
--     a package bought alone (null while unset: payment is then unavailable, no value in code). The rest is 0412's.
--   * app.complete_zero_money_order also grants the order's packages (the grant_package port) when it has package lines,
--     as apply_payment does after a paid charge, so a package fully covered by a code or the wallet is created at once.
--   * app.end_package_order (new) and app.expire_package_order (0415): a package order that ends unpaid gives back its
--     code use, birthday entitlement and wallet spend.

create or replace function app.start_payment(p_order uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_status text;
  o public.orders%rowtype;
  v_id uuid;
begin
  if v_club is null then
    raise exception 'start_payment needs a club in the context' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or o.status <> 'open' then
    raise exception 'start_payment: no open order' using errcode = 'P0001';
  end if;
  if not (app.has_any_role('owner', 'front_desk') or (app.user_id() is not null and o.customer_id = app.user_id())
          or coalesce(current_setting('role', true), '') = 'booq_worker') then
    raise exception 'start_payment: not allowed' using errcode = '42501';
  end if;
  if o.priced_at is null then
    raise exception 'start_payment: the order is not priced' using errcode = 'P0001';
  end if;
  if o.money_satang = 0 then
    raise exception 'start_payment: nothing to pay' using errcode = 'P0001';
  end if;
  -- An order with bookings is paid inside its hold (D18); a package bought alone has none (D74).
  if exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order)
     and not exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order
                      and b.status = 'awaiting_payment' and b.hold_expires_at > app.now()) then
    raise exception 'start_payment: the hold is not running' using errcode = 'P0001';
  end if;
  select id into v_id from public.payment where club_id = v_club and order_id = p_order and method = 'beam' and status = 'pending';
  if found then
    return v_id;
  end if;
  select c.status into v_status from public.club c where c.id = v_club;
  insert into public.payment (club_id, order_id, method, status, environment, gateway, amount_satang, is_test)
    values (v_club, p_order, 'beam', 'pending', case when v_status = 'testing' then 'test' else 'live' end, 'beam', o.money_satang, o.is_test)
    returning id into v_id;
  return v_id;
end $$;

create or replace function app.payment_charge_context(p_payment uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.payment%rowtype;
  o public.orders%rowtype;
  v_merchant text;
  v_margin text;
  v_hold timestamptz;
  v_package_minutes text;
  v_has_bookings boolean;
begin
  if v_club is null then
    raise exception 'payment_charge_context needs a club in the context' using errcode = 'P0001';
  end if;
  select * into p from public.payment where club_id = v_club and id = p_payment;
  if not found or p.method <> 'beam' or p.status <> 'pending' then
    raise exception 'payment: no pending Beam payment' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p.order_id;
  if not (app.has_any_role('owner', 'front_desk') or (app.user_id() is not null and o.customer_id = app.user_id())) then
    raise exception 'payment: no pending Beam payment' using errcode = 'P0001';   -- not yours looks like missing
  end if;
  select case p.environment when 'test' then c.merchant_id_test else c.merchant_id_live end into v_merchant
    from public.payment_connection c where c.club_id = v_club;
  select c.value #>> '{}' into v_margin from platform.config c where c.key = 'qr_expiry_margin_seconds';
  select min(b.hold_expires_at) into v_hold from public.booking b
   where b.club_id = v_club and b.order_id = p.order_id and b.status = 'awaiting_payment' and b.hold_expires_at > app.now();
  select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p.order_id) into v_has_bookings;
  select s.value #>> '{}' into v_package_minutes from public.club_setting s where s.club_id = v_club and s.key = 'package_qr_minutes';
  return jsonb_build_object('merchant_id', nullif(btrim(coalesce(v_merchant, '')), ''), 'environment', p.environment,
                            'amount_satang', p.amount_satang, 'hold_expires_at', v_hold,
                            'qr_expiry_margin_seconds', case when v_margin ~ '^[0-9]+$' then v_margin::integer end,
                            'has_bookings', v_has_bookings,
                            'package_qr_minutes', case when v_package_minutes ~ '^[1-9][0-9]*$' then v_package_minutes::integer end);
end $$;

create or replace function app.complete_zero_money_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  v_receipt uuid;
  v_has_bookings boolean;
begin
  if v_club is null or app.user_id() is null then
    raise exception 'order: not allowed' using errcode = '42501';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or not (o.customer_id = app.user_id() or app.has_any_role('owner', 'front_desk')) then
    raise exception 'order: no such order' using errcode = 'P0001';       -- missing and not yours look the same
  end if;
  if o.status = 'paid' and o.zero_money_receipt_id is not null then
    return o.zero_money_receipt_id;                                       -- a second call
  end if;
  if o.status <> 'open' or o.priced_at is null or o.kind <> 'sale' or o.money_satang <> 0 then
    raise exception 'order: not an open priced order with nothing to pay' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.order_line l where l.club_id = v_club and l.order_id = p_order) then
    raise exception 'order: the order has no lines' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order) into v_has_bookings;
  if exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order and b.status <> 'confirmed') then
    raise exception 'order: a booking of the order is not confirmed' using errcode = 'P0001';
  end if;
  update public.orders set status = 'paid' where club_id = v_club and id = p_order;
  -- A package covered in full (a code or the wallet) is created now, as apply_payment does after a paid charge.
  if exists (select 1 from public.order_line l where l.club_id = v_club and l.order_id = p_order and l.kind = 'package') then
    execute format('select %s($1)', app.port_of('grant_package')) using p_order;
  end if;
  execute format('select %s($1, $2, $3)', app.port_of('issue_receipt')) into v_receipt using p_order, null::uuid, 'order';
  update public.orders set zero_money_receipt_id = v_receipt where club_id = v_club and id = p_order;
  if v_has_bookings then
    execute format('select %s($1, $2, $3, $4, $5)', app.port_of('enqueue_message'))
      using 'booking_confirmed', o.customer_id, jsonb_build_object('order_id', p_order), 'confirmed:' || p_order::text, app.now();
  end if;
  return v_receipt;
end $$;

-- A package order that ends unpaid gives back what it took when it was placed: the code use and birthday entitlement
-- (as F04's release handler does) and any wallet spend (as F06's does). A package order has no bookings, so
-- app.release_hold, which runs those handlers, never sees it. Called by the Pay route when Beam cannot be used
-- (payment_unavailable: its pending payment fails) and by app.expire_package_order (expired). No receipt, no message.
-- Lock order (FA 3.4): the customer, then the order, then its payment.
create function app.end_package_order(p_order uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  o public.orders%rowtype;
begin
  if v_club is null then
    raise exception 'end_package_order needs a club in the context' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('payment_unavailable', 'expired') then
    raise exception 'unknown end reason' using errcode = '22023';
  end if;
  select customer_id into v_customer from public.orders where club_id = v_club and id = p_order;
  if v_customer is not null then
    perform app.lock_customer(v_customer);
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or o.status <> 'open'
     or exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order) then
    return false;
  end if;
  if not (app.has_any_role('owner', 'front_desk') or coalesce(current_setting('role', true), '') = 'booq_worker'
          or (p_reason = 'payment_unavailable' and app.user_id() is not null and o.customer_id = app.user_id())) then
    raise exception 'end_package_order: not allowed' using errcode = '42501';
  end if;
  if p_reason = 'payment_unavailable' then
    update public.payment set status = 'failed', failure_code = 'payment_unavailable', qr_image = null
     where club_id = v_club and order_id = p_order and method = 'beam' and status = 'pending';
  end if;
  update public.orders set status = 'cancelled' where club_id = v_club and id = p_order;
  perform app.restore_order_entitlements(p_order, p_reason);
  if exists (select 1 from public.wallet_ledger w where w.club_id = v_club and w.order_id = p_order and w.reason = 'spend') then
    perform app.wallet_return(p_order, p_reason);
  end if;
  return true;
end $$;

-- 0415's expiry, now through app.end_package_order so the code use and the wallet spend come back too (PAY-04-AC2).
-- The customer is locked before the order (FA 3.4).
create or replace function app.expire_package_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  v_rows integer;
begin
  perform app.require_worker();
  select customer_id into v_customer from public.orders where club_id = v_club and id = p_order;
  if v_customer is not null then
    perform app.lock_customer(v_customer);
  end if;
  perform 1 from public.orders where club_id = v_club and id = p_order and status = 'open' for update;
  if not found or exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order) then
    return false;
  end if;
  update public.payment set status = 'expired', qr_image = null
   where club_id = v_club and order_id = p_order and method = 'beam' and status = 'pending'
     and qr_expires_at is not null and qr_expires_at <= app.now();
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;                                  -- paid or not yet due: nothing changes
  end if;
  return app.end_package_order(p_order, 'expired');
end $$;

alter function app.end_package_order(uuid, text) owner to booq_owner;
revoke all on function app.end_package_order(uuid, text) from public;
grant execute on function app.end_package_order(uuid, text) to booq_app, booq_worker;
