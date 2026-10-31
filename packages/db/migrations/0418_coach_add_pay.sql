-- F04-T15 / migration 0418: the order that adds a coach to a booking goes through Pay (R2-AC9, D111; F07 design 5.5;
-- COACH-03). Built by BE-C, approved by the orchestrator on 31 Oct. app.add_coach_to_booking (0806) claims the coach on
-- the player's confirmed court booking for a priced order of its own; that order has no booking of its own and its hold
-- is booking_coach_add.hold_expires_at. Numbered above the last definition of each object it redefines (D159):
-- app.add_order_lines (0317), app.start_payment, app.payment_charge_context, app.end_package_order and
-- app.expire_package_order (0416), app.package_order_expiry_candidates (0415).
--   * add_order_lines: a coach line may name the court booking of the order's coach add.
--   * start_payment: such an order is paid inside its add hold, which must be running.
--   * payment_charge_context: its hold is the add hold, and has_bookings is true for it, so the QR life follows the hold
--     (startPayment's booking path), not package_qr_minutes.
--   * The package-order path (end_package_order, the expiry candidates and expire_package_order) leaves such an order
--     alone: its hold ends through app.release_coach_add and the hold_release job (F07-T06c).
--   * app.live_coach_add(booking) (new): the caller's own pending add on their booking whose hold runs (a second tap,
--     D47), since a player has no read on booking_coach_add (0808).
-- A coach add with nothing to pay is confirmed by add_coach_to_booking itself; complete_zero_money_order (0417) then
-- marks the order paid and issues its receipt unchanged (the order has no booking of its own).

create or replace function app.add_order_lines(p_order uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  o public.orders%rowtype;
  l jsonb;
begin
  if v_club is null then
    raise exception 'add_order_lines needs a club in the context' using errcode = 'P0001';
  end if;
  if v_user is null then
    raise exception 'order: not allowed' using errcode = '42501';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  if not found or (o.customer_id is distinct from v_user and not app.has_any_role('owner', 'front_desk')) then
    raise exception 'order: no such order' using errcode = 'P0001';       -- missing and not yours look the same
  end if;
  if o.status <> 'open' or o.priced_at is null or o.kind <> 'sale' then
    raise exception 'order: not an open priced sale' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_line x where x.club_id = v_club and x.order_id = p_order) then
    raise exception 'order: the lines are already written' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'order: invalid lines' using errcode = 'P0001';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' or l ->> 'kind' not in ('court_hour', 'coach', 'add_on', 'package', 'class_seat') then
      raise exception 'order: invalid line kind' using errcode = 'P0001';
    end if;
    -- A line names a booking of its own order, or (0418) the court booking a coach is added to by this order.
    if (l ->> 'booking_id') is not null and not exists (
         select 1 from public.booking b where b.club_id = v_club and b.id = (l ->> 'booking_id')::uuid and b.order_id = p_order)
       and not (l ->> 'kind' = 'coach' and exists (
         select 1 from public.booking_coach_add a where a.club_id = v_club and a.order_id = p_order
            and a.booking_id = (l ->> 'booking_id')::uuid and a.status in ('pending', 'confirmed'))) then
      raise exception 'order: a line names a booking of another order' using errcode = 'P0001';
    end if;
    begin
      insert into public.order_line (club_id, order_id, position, kind, booking_id, add_on_id, package_product_id, description_key, name_th, name_en,
                                     unit_price_satang, discount_satang, net_satang, credit_package_id, credit_units, credit_value_satang,
                                     wallet_satang, money_satang, scope)
      values (v_club, p_order, (l ->> 'position')::integer, l ->> 'kind', nullif(l ->> 'booking_id', '')::uuid, nullif(l ->> 'add_on_id', '')::uuid,
              nullif(l ->> 'package_product_id', '')::uuid, l ->> 'description_key', l ->> 'name_th', l ->> 'name_en',
              (l ->> 'unit_price_satang')::integer, coalesce((l ->> 'discount_satang')::integer, 0), (l ->> 'net_satang')::integer,
              nullif(l ->> 'credit_package_id', '')::uuid, coalesce((l ->> 'credit_units')::integer, 0), coalesce((l ->> 'credit_value_satang')::integer, 0),
              coalesce((l ->> 'wallet_satang')::integer, 0), coalesce((l ->> 'money_satang')::integer, 0), coalesce(l -> 'scope', '{}'::jsonb));
    exception
      when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or foreign_key_violation or unique_violation then
        raise exception 'order: invalid line (%)', sqlerrm using errcode = 'P0001';
    end;
  end loop;
end $$;

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
  -- An order with bookings is paid inside its hold (D18); an order that adds a coach inside its add hold (0806); a
  -- package bought alone has none (D74).
  if exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order) then
    if not exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order
                    and b.status = 'awaiting_payment' and b.hold_expires_at > app.now()) then
      raise exception 'start_payment: the hold is not running' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.order_id = p_order) then
    if not exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.order_id = p_order
                    and a.status = 'pending' and a.hold_expires_at > app.now()) then
      raise exception 'start_payment: the hold is not running' using errcode = 'P0001';
    end if;
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
  -- An order that adds a coach (0806) is held by its add hold, not by a booking of its own (0418).
  if v_hold is null then
    select a.hold_expires_at into v_hold from public.booking_coach_add a
     where a.club_id = v_club and a.order_id = p.order_id and a.status = 'pending' and a.hold_expires_at > app.now();
  end if;
  select exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p.order_id)
      or exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.order_id = p.order_id) into v_has_bookings;
  select s.value #>> '{}' into v_package_minutes from public.club_setting s where s.club_id = v_club and s.key = 'package_qr_minutes';
  return jsonb_build_object('merchant_id', nullif(btrim(coalesce(v_merchant, '')), ''), 'environment', p.environment,
                            'amount_satang', p.amount_satang, 'hold_expires_at', v_hold,
                            'qr_expiry_margin_seconds', case when v_margin ~ '^[0-9]+$' then v_margin::integer end,
                            'has_bookings', v_has_bookings,
                            'package_qr_minutes', case when v_package_minutes ~ '^[1-9][0-9]*$' then v_package_minutes::integer end);
end $$;

create or replace function app.end_package_order(p_order uuid, p_reason text) returns boolean
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
     or exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order)
     or exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.order_id = p_order) then
    return false;                                   -- not a package bought alone: its hold ends through its own release
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

create or replace function app.package_order_expiry_candidates() returns setof uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  perform app.require_worker();
  return query
    select o.id from public.orders o
     where o.club_id = app.club_id() and o.status = 'open'
       and not exists (select 1 from public.booking b where b.club_id = o.club_id and b.order_id = o.id)
       and not exists (select 1 from public.booking_coach_add a where a.club_id = o.club_id and a.order_id = o.id)
       and exists (select 1 from public.payment p where p.club_id = o.club_id and p.order_id = o.id and p.method = 'beam'
                    and p.status = 'pending' and p.qr_expires_at is not null and p.qr_expires_at <= app.now())
     order by o.created_at, o.id;
end $$;

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
  if not found or exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order)
     or exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.order_id = p_order) then
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

create function app.live_coach_add(p_booking uuid) returns table (order_id uuid, hold_expires_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null or app.user_id() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select a.order_id, a.hold_expires_at from public.booking_coach_add a
      join public.booking b on b.club_id = a.club_id and b.id = a.booking_id
     where a.club_id = app.club_id() and a.booking_id = p_booking and a.status = 'pending' and a.hold_expires_at > app.now()
       and (b.customer_id = app.user_id() or app.has_any_role('owner', 'front_desk'));
end $$;
alter function app.live_coach_add(uuid) owner to booq_owner;
revoke all on function app.live_coach_add(uuid) from public;
grant execute on function app.live_coach_add(uuid) to booq_app;
