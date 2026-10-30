-- F06-T09 / migration 0511: F06's payment ports, and the up-front wallet and package lock for Pay.
-- F06 design 4.4 and 4.9; docs/architecture/apply-payment.md. Requirements: PKG-01-AC12, R3-AC1, AC7, AC9.
--   app.lock_wallet_and_packages(customer)        lock order step 2 (FA 3.4) taken before Pay's court locks, so the
--                                                 port's later locks of the same rows are re-entrant (BE-C's Pay fix)
--   app.port_reserve_credit_and_wallet(order)     all the credit and wallet parts of the order, or nothing
--   app.port_grant_package(order)                 the packages of a paid package order (app.grant_package, 0508)
--   app.port_credit_wallet(kind, customer, amount, reason, key, payment)
--                                                 wallet value plus its wallet_credit order; returns the order id
-- The ports hold no business rule of their own: they call the functions of 0505 to 0508. wallet_ledger.payment_id
-- exists since 0502. A port that is not registered raises payment:port_missing (0404).

-- Lock order step 2 for a customer: the wallet anchor (created when missing) and the customer's active packages, in
-- id order. Pay calls it before it counts the promo use and claims the court, so no wallet or package lock is taken
-- after a court lock. The player for themselves, or the club's front desk or owner; the worker and the definer
-- functions (no app user) may always.
create function app.lock_wallet_and_packages(p_customer uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') = 'booq_app'
     and app.user_id() is distinct from p_customer and not app.has_any_role('owner', 'front_desk') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform app.lock_wallet(p_customer);
  perform 1 from public.customer_package cp
   where cp.club_id = app.club_id() and cp.customer_id = p_customer and cp.expires_at > app.now()
   order by cp.id for update;
end $$;

-- The marker of design 4.4: a line paid with credit from the package bought in this same order carries no package
-- id and scope.new_package_line, the product id of that package line (F04 stores it). The package is the one this
-- order granted for that product.
create function app.resolve_line_package(p_line uuid) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  l public.order_line%rowtype;
  v_pkg uuid;
begin
  select * into l from public.order_line ol where ol.club_id = app.club_id() and ol.id = p_line;
  if l.credit_package_id is not null then
    return l.credit_package_id;
  end if;
  if not (l.scope ? 'new_package_line') then
    return null;
  end if;
  select cp.id into v_pkg from public.customer_package cp
   where cp.club_id = app.club_id() and cp.order_id = l.order_id and cp.product_id::text = l.scope ->> 'new_package_line';
  return v_pkg;
end $$;

-- reserve_credit_and_wallet (design 4.9): true when every credit and every wallet part of every line of the order is
-- reserved, false and nothing written when any of them cannot be (a credit missing, used up or expired, the wallet
-- short, the customer not claimed or not active). A line already reserved and not returned is skipped by the
-- functions themselves, so a second call after success returns true and writes nothing. Pay (BE-C, F04) calls it
-- as booq_app for the player's own open order or as staff; app.apply_payment as the worker.
create function app.port_reserve_credit_and_wallet(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  l record;
  v_pkg uuid;
begin
  select * into o from public.orders where club_id = v_club and id = p_order;
  if not found then
    raise exception 'payment:order_not_found' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('role', true), '') = 'booq_app' then
    if o.customer_id is distinct from app.user_id() and not app.has_any_role('owner', 'front_desk') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if o.status <> 'open' then
      raise exception 'payment:order_not_open' using errcode = 'P0001';
    end if;
  end if;
  if not exists (select 1 from public.order_line ol where ol.club_id = v_club and ol.order_id = p_order
                  and (ol.credit_units > 0 or ol.wallet_satang > 0)) then
    return true;
  end if;
  if o.customer_id is null then
    return false;                           -- a walk-in without a customer record has no credit or wallet
  end if;
  begin
    perform app.lock_wallet_and_packages(o.customer_id);
    for l in select ol.id, ol.booking_id, ol.credit_units, ol.wallet_satang from public.order_line ol
              where ol.club_id = v_club and ol.order_id = p_order and (ol.credit_units > 0 or ol.wallet_satang > 0)
              order by ol.position loop
      if l.credit_units > 0 then
        if l.credit_units <> 1 then
          raise exception 'payment:reserve:credit_units' using errcode = 'P0001';   -- F04 allocates one credit per line
        end if;
        v_pkg := app.resolve_line_package(l.id);
        if v_pkg is null then
          raise exception 'credit:package_not_found' using errcode = 'P0001';
        end if;
        perform app.credit_reserve(v_pkg, l.booking_id, l.id);
      end if;
      if l.wallet_satang > 0 then
        perform app.wallet_spend(o.customer_id, l.wallet_satang, p_order, l.id);
      end if;
    end loop;
  exception when others then
    -- The value is not there any more: nothing of this block is kept and the caller sends the money to the wallet.
    if sqlerrm = 'customer_not_claimed' or sqlerrm in ('credit:expired', 'credit:used_up', 'credit:package_not_found', 'wallet:insufficient') then
      return false;
    end if;
    raise;
  end;
  return true;
end $$;

create function app.port_grant_package(p_order uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  perform app.grant_package(p_order);
end $$;

-- credit_wallet (design 4.9, D37): the order kind is wallet_credit and the reason one of the four a payment can have;
-- anything else raises. The same dedupe key returns the same order and creates nothing.
create function app.port_credit_wallet(
  p_order_kind text, p_customer uuid, p_amount_satang integer, p_reason text, p_dedupe_key text, p_payment uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if p_order_kind is distinct from 'wallet_credit' then
    raise exception 'payment:wallet:order_kind' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('late_payment', 'duplicate_payment', 'wrong_amount', 'refund') then
    raise exception 'payment:wallet:reason' using errcode = 'P0001';
  end if;
  if p_amount_satang is null or p_amount_satang <= 0 then
    raise exception 'payment:wallet:amount' using errcode = 'P0001';
  end if;
  return app.wallet_credit_order(p_customer, p_amount_satang, p_reason, p_dedupe_key, p_payment);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.lock_wallet_and_packages(uuid)', 'app.resolve_line_package(uuid)', 'app.port_reserve_credit_and_wallet(uuid)',
    'app.port_grant_package(uuid)', 'app.port_credit_wallet(text, uuid, integer, text, text, uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
-- Pay runs as booq_app (the player's own order, or staff): the up-front lock and the reserve. The webhook and lookup
-- run as the worker. grant_package and credit_wallet stay worker-only (app.apply_payment and the cash and wrong
-- amount functions reach them through app.port_of, as definer functions).
grant execute on function app.lock_wallet_and_packages(uuid) to booq_app, booq_worker;
grant execute on function app.port_reserve_credit_and_wallet(uuid) to booq_app, booq_worker;
grant execute on function app.port_grant_package(uuid) to booq_worker;
grant execute on function app.port_credit_wallet(text, uuid, integer, text, text, uuid) to booq_worker;

select app.register_payment_port('reserve_credit_and_wallet', 'app.port_reserve_credit_and_wallet(uuid)'::regprocedure);
select app.register_payment_port('grant_package', 'app.port_grant_package(uuid)'::regprocedure);
select app.register_payment_port('credit_wallet', 'app.port_credit_wallet(text, uuid, integer, text, text, uuid)'::regprocedure);
