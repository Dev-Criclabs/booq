-- F05-T04a / migration 0403: starting a payment, and the release reason payment_unavailable.
-- Requirements: PAY-02-AC1 to AC3, PAY-01-AC7; decisions D47, D72, D75. F05 design 4.3, 5.1.
--   * booking.release_reason and app.release_hold accept 'payment_unavailable': the hold is released when
--     the club's Beam keys are missing or Beam cannot be reached. The caller is the order's player (the Pay
--     route acts for them), staff or the worker. The handlers other features registered run as for any release
--     (F04 restores credit, wallet and code); F10's "Booking released" message must skip this reason.
--   * app.start_payment(order): the pending Beam payment of a priced order for exactly its money due, or the
--     one that already exists (a second tap, D47, D72). A zero money order takes none (D13). The key set follows
--     the club status: Testing uses the test set, Live and Paused the live set (PAY-01-AC4).
--   * The F05 release handler fails the order's pending payments (failure_code payment_unavailable, QR cleared).
--   * app.flag_key_check_failed(): the owner flag of a failed key check (PAY-01-AC7, D75). It is separate from
--     the release because Beam being unreachable raises the P1 alert but no owner flag (design 5.1 steps 1 and 4).
--     The P1 alert itself is raised by the server code, not the database.

alter table public.booking drop constraint booking_release_reason_values;
alter table public.booking add constraint booking_release_reason_values
  check (release_reason in ('expired', 'player', 'closed', 'staff', 'payment_unavailable'));

create or replace function app.release_hold(p_order uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_customer uuid;
  v_ids uuid[];
  v_now timestamptz := app.now();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_worker boolean := coalesce(current_setting('role', true), '') = 'booq_worker';
  h record;
begin
  if v_club is null then
    raise exception 'release_hold needs a club in the context' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('expired', 'player', 'closed', 'staff', 'payment_unavailable') then
    raise exception 'unknown release reason' using errcode = '22023';
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
  elsif p_reason in ('player', 'payment_unavailable') and not (v_staff or v_worker) then
    -- The player ends their own hold; the Pay route, acting for the player, ends it when Beam cannot be used.
    if app.user_id() is null or v_customer is distinct from app.user_id() then
      raise exception 'release not allowed' using errcode = '42501';
    end if;
  elsif p_reason in ('player', 'payment_unavailable') then
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

create function app.start_payment(p_order uuid) returns uuid
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
  -- The hold must still be running (a payment is for a hold, D18).
  if not exists (select 1 from public.booking b where b.club_id = v_club and b.order_id = p_order
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

create function app.f05_payment_unavailable(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null then
    raise exception 'f05_payment_unavailable needs a club in the context' using errcode = 'P0001';
  end if;
  if p_reason = 'payment_unavailable' then
    update public.payment set status = 'failed', failure_code = 'payment_unavailable', qr_image = null
     where club_id = v_club and order_id = p_order and method = 'beam' and status = 'pending';
  end if;
end $$;

create function app.flag_key_check_failed() returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null then
    raise exception 'flag_key_check_failed needs a club in the context' using errcode = 'P0001';
  end if;
  if app.user_id() is null and coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'flag_key_check_failed: not allowed' using errcode = '42501';
  end if;
  insert into public.owner_flag (club_id, kind, is_test)
    values (v_club, 'key_check_failed', (select c.status = 'testing' from public.club c where c.id = v_club))
    on conflict do nothing;   -- one open flag per club and kind: a repeat does not pile up
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.start_payment(uuid)', 'app.f05_payment_unavailable(uuid, text)', 'app.flag_key_check_failed()'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
  grant execute on function app.start_payment(uuid) to booq_app, booq_worker;
  grant execute on function app.flag_key_check_failed() to booq_app, booq_worker;
end $$;

select app.register_release_handler('f05_payment_unavailable', 'app.f05_payment_unavailable(uuid, text)'::regprocedure::regproc, 20);
