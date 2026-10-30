-- F06-T05 / migration 0509: F06's release handler. F06 design 4.3; F03 design 4.5.
-- Requirements: R1-AC8, BOOK-03-AC5 (F03), F04 R7-AC6.
-- When a hold ends unpaid (any release reason: expired, player, staff, closed, payment_unavailable,
-- offer_ended), app.release_hold runs the registered handlers after the bookings are released. F06's
-- returns every credit reserved for the order's bookings to its own package and every wallet spend of the
-- order to the wallet, by new rows (R1-AC8), in id order. A hold that ends is never a player cancel, so a
-- credit always comes back, even when the package expired meanwhile (D85 concerns cancelling a confirmed
-- booking). Idempotent through the return keys: a second release changes nothing.
-- Registered with ord 30: F04 10, F05 20, F06 30, F07 35, F08 50, F10 60.
create function app.f06_release(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b record;
begin
  if v_club is null then
    raise exception 'f06_release needs a club in the context' using errcode = 'P0001';
  end if;
  for b in select bk.id from public.booking bk
            where bk.club_id = v_club and bk.order_id = p_order and bk.status = 'released' order by bk.id loop
    perform app.credit_return(b.id, 'release');
  end loop;
  -- Only an order that spent wallet takes the wallet lock: most holds have no wallet part at all.
  if exists (select 1 from public.wallet_ledger w where w.club_id = v_club and w.order_id = p_order and w.reason = 'spend') then
    perform app.wallet_return(p_order, coalesce(nullif(btrim(p_reason), ''), 'release'));
  end if;
end $$;
alter function app.f06_release(uuid, text) owner to booq_owner;
revoke all on function app.f06_release(uuid, text) from public;

select app.register_release_handler('f06_credit_wallet', 'app.f06_release(uuid, text)'::regprocedure::regproc, 30);
