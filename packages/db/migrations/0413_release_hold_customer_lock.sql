-- Deadlock fix / migration 0413: app.release_hold takes the order's customer lock first (FA 3.4 step 0).
-- Requirements: BOOK-03-AC5, AC6; FA 3.4; decision D159 (numbered above 0411, the last definition of release_hold,
-- and above 0412; the next free number).
--
-- The cycle (reproduced by packages/db/src/release-hold-customer-lock.test.ts with retries off): the hold release
-- job locked an order's booking rows (step 3) and then ran the release handlers, and F06's wallet and credit returns
-- take the customer's lock (step 0) through app.lock_wallet and app.credit_return. A Pay of the same customer held
-- that customer lock (app.create_priced_order takes it first, 0318) and, inside reserve_court's lazy release of the
-- customer's expired hold, waited for those same booking rows. Each waited for the other (40P01).
--
-- Now release_hold locks the order's customer before the booking rows, so the order is customer, then bookings,
-- then handlers, and a handler's own customer lock is re-entrant. A Pay and a release of one customer queue on the
-- customer lock. The remaining step 3 to step 2 order inside the handlers (bookings, then the customer's package
-- rows) is serialised by the customer lock now held first. The function is otherwise 0411's text.

create or replace function app.release_hold(p_order uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  v_order_customer uuid;
  v_ids uuid[];
  v_now timestamptz := app.now();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_worker boolean := coalesce(current_setting('role', true), '') = 'booq_worker';
  h record;
begin
  if v_club is null then
    raise exception 'release_hold needs a club in the context' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('expired', 'player', 'closed', 'staff', 'payment_unavailable', 'offer_ended') then
    raise exception 'unknown release reason' using errcode = '22023';
  end if;

  -- Lock order step 0 (FA 3.4): the order's customer before its booking rows, so the release handlers (which
  -- take the customer lock for wallet and credit returns) never wait for a customer lock held by a Pay that is
  -- itself waiting for these booking rows. A walk in order has no customer and no lock.
  select o.customer_id into v_order_customer from public.orders o where o.club_id = v_club and o.id = p_order;
  if v_order_customer is not null then
    perform app.lock_customer(v_order_customer);
  end if;

  -- Lock the order's bookings in id order (FA 3.4 step 3) and look at them again under the lock,
  -- so the job, the lazy release and a payment cannot all win.
  select array_agg(id order by id), max(customer_id::text)::uuid
    into v_ids, v_customer
    from (
      select id, customer_id from public.booking
       where club_id = v_club and order_id = p_order and status = 'awaiting_payment'
       order by id for update
    ) b;
  if v_ids is null then
    return false;
  end if;

  if p_reason = 'expired' then
    -- Anyone may finish an expired hold; nobody may end a live one this way.
    if exists (select 1 from public.booking where club_id = v_club and id = any (v_ids) and hold_expires_at > v_now) then
      return false;
    end if;
  elsif p_reason in ('player', 'payment_unavailable', 'offer_ended') and not (v_staff or v_worker) then
    -- The player ends their own hold; the Pay route, acting for the player, ends it when Beam cannot be used;
    -- the player of a waitlist offer declines it (offer_ended).
    if app.user_id() is null or v_customer is distinct from app.user_id() then
      raise exception 'release not allowed' using errcode = '42501';
    end if;
  elsif p_reason in ('player', 'payment_unavailable', 'offer_ended') then
    null;   -- staff and the worker may end it too
  elsif not (v_staff or (p_reason = 'closed' and v_worker)) then
    raise exception 'release not allowed' using errcode = '42501';
  end if;

  update public.booking
     set status = 'released', release_reason = p_reason, released_at = v_now, hold_expires_at = null, updated_at = v_now
   where club_id = v_club and id = any (v_ids) and status = 'awaiting_payment';
  delete from public.occupancy where club_id = v_club and booking_id = any (v_ids) and state = 'held';

  for h in select handler from app.release_handlers order by ord, name loop
    execute format('select %s($1, $2)', h.handler) using p_order, p_reason;
  end loop;
  return true;
end $$;
alter function app.release_hold(uuid, text) owner to booq_owner;
revoke all on function app.release_hold(uuid, text) from public;
grant execute on function app.release_hold(uuid, text) to booq_app, booq_worker;
