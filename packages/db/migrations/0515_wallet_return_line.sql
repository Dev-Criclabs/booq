-- F06-T25 / migration 0515: app.wallet_return_line(order_line, reason). F06 design 4.1; F09 design 4.4 and A-4.
-- Requirements: PKG-01-AC8, R1-AC6, AC7; decision D158. Built by BE-B for F09 with the orchestrator's approval.
--
-- app.wallet_return(order, reason) (0505) gives back every spend of an order. A cancel of one hour of a two hour
-- order must give back only that hour's wallet use (D111, D158), so this returns the spend rows of one order line:
-- the wallet lock of the line's customer (lock order step 2, after the customer lock that lock_wallet takes), then one
-- 'return' row per 'spend' row of the line, in id order. The dedupe key is wallet_return's own, return:{spend_row}, so
-- the two functions never return the same spend twice whichever runs first, and a repeat writes nothing. p_reason is
-- the caller's cause (player_cancel, club_cancel, closure ...); the ledger reason is always return. Returns the number
-- of rows written. A line with no spend (a walk in order, a customer who never paid by wallet) returns 0 and takes no lock. Not granted to an app role: F09's
-- return_booking_value and F08's cancel_session call it from their definer functions.

create function app.wallet_return_line(p_order_line uuid, p_reason text) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  v_order uuid;
  s record;
  v_n integer := 0;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'wallet:reason' using errcode = 'P0001';
  end if;
  select l.order_id, o.customer_id into v_order, v_customer
    from public.order_line l join public.orders o on o.club_id = l.club_id and o.id = l.order_id
   where l.club_id = v_club and l.id = p_order_line;
  if v_order is null then
    raise exception 'wallet:line_not_found' using errcode = 'P0001';
  end if;
  -- No spend on the line, nothing to return: and no wallet lock, which would refuse a customer who is not an app user
  -- (wallet:customer_not_found, the 0509 rule).
  if v_customer is null
     or not exists (select 1 from public.wallet_ledger w where w.club_id = v_club and w.order_line_id = p_order_line and w.reason = 'spend') then
    return 0;
  end if;
  perform app.lock_wallet(v_customer);
  for s in select w.* from public.wallet_ledger w
            where w.club_id = v_club and w.order_line_id = p_order_line and w.reason = 'spend' order by w.id loop
    insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, booking_id, order_id, order_line_id, dedupe_key)
      values (v_club, s.customer_id, -s.change_satang, 'return', s.booking_id, s.order_id, s.order_line_id, 'return:' || s.id::text)
      on conflict (club_id, dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
alter function app.wallet_return_line(uuid, text) owner to booq_owner;
revoke all on function app.wallet_return_line(uuid, text) from public;
