-- F06 / migration 0520: app.port_reserve_credit_and_wallet skips the marker line at Pay (F04 bundle accept, R6-AC3;
-- F06 design 4.4, 4.9; D159: a later number redefines 0511's function, which stays as merged).
-- A line paid from a package bought in the same order carries scope.new_package_line (the product) and no package id.
-- At Pay (the caller is booq_app, on the open order) that package does not exist yet, so 0511 returned false and Pay
-- could not take the wallet part. Now, for booq_app only, such a line is skipped: no credit is reserved for it at Pay.
-- When the payment lands, apply_payment grants the package (grant_package port) and then calls this port again as the
-- definer, which resolves the line to the new package and reserves its one credit (return true twice writes once: the
-- reserve and wallet keys carry the line and attempt). Every other line and the wallet part behave as in 0511; for the
-- definer and the worker a marker whose package is missing is still credit:package_not_found, so false.
create or replace function app.port_reserve_credit_and_wallet(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  o public.orders%rowtype;
  l record;
  v_pkg uuid;
  v_app boolean := coalesce(current_setting('role', true), '') = 'booq_app';
begin
  select * into o from public.orders where club_id = v_club and id = p_order;
  if not found then
    raise exception 'payment:order_not_found' using errcode = 'P0001';
  end if;
  if v_app then
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
    for l in select ol.id, ol.booking_id, ol.credit_units, ol.wallet_satang, ol.credit_package_id, ol.scope from public.order_line ol
              where ol.club_id = v_club and ol.order_id = p_order and (ol.credit_units > 0 or ol.wallet_satang > 0)
              order by ol.position loop
      if l.credit_units > 0 then
        if l.credit_units <> 1 then
          raise exception 'payment:reserve:credit_units' using errcode = 'P0001';   -- F04 allocates one credit per line
        end if;
        v_pkg := app.resolve_line_package(l.id);
        if v_pkg is null and v_app and l.credit_package_id is null and l.scope ? 'new_package_line' then
          -- Pay of an order whose hour is paid from the package it buys: that package is granted when the payment
          -- lands, and apply_payment then reserves this line from it (grant_package, then reserve). Skipped here.
          null;
        elsif v_pkg is null then
          raise exception 'credit:package_not_found' using errcode = 'P0001';
        else
          perform app.credit_reserve(v_pkg, l.booking_id, l.id);
        end if;
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

alter function app.port_reserve_credit_and_wallet(uuid) owner to booq_owner;
revoke all on function app.port_reserve_credit_and_wallet(uuid) from public;
grant execute on function app.port_reserve_credit_and_wallet(uuid) to booq_app, booq_worker;
