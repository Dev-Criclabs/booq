-- F03-T30 / migration 0411: the release reason offer_ended. F08 design 4.10, change C-1 and assumption A-3;
-- requirements CLASS-02-AC2, AC14, WAIT-01-AC3; decisions D155, D159.
-- A waitlist offer is a held booking (FA 3.6). When the offer ends (the player declines, the offer passes its
-- time, it is passed on, or its session or slot goes) F08 releases the hold with reason offer_ended and every
-- registered release handler runs as for any release. F10's "Booking released" message must skip this reason,
-- as it skips payment_unavailable. Who may end an offer: the offer's player (declining), staff and the worker.
-- The check that offer_ended applies only to a booking with a waitlist entry is F08's (F08-T03 adds the column).
-- Numbered 0411 under D159: it redefines release_hold and the release reason CHECK, last defined by F05's 0403,
-- so it must run after 0403 on every database. The function is 0403's text with offer_ended added.

alter table public.booking drop constraint booking_release_reason_values;
alter table public.booking add constraint booking_release_reason_values
  check (release_reason in ('expired', 'player', 'closed', 'staff', 'payment_unavailable', 'offer_ended'));

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
  if p_reason is null or p_reason not in ('expired', 'player', 'closed', 'staff', 'payment_unavailable', 'offer_ended') then
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
