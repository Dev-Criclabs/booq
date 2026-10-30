-- F03-T06 / migration 0210: releasing a hold. F03 design 4.5 and FA 3.2, 3.4.
-- Requirements: BOOK-03-AC5, AC6, BOOK-04-AC6. Decisions D45, D48. Review SR-07.
-- (0204 to 0209 of the design's numbering are left for the Architect's views and policies;
-- F03 functions are numbered 0210 and up.)
--
-- app.release_hold(order, reason) is the only way a hold ends without payment. It is SECURITY
-- DEFINER with a fixed search path; the club comes from app.club_id() only. It works on an
-- order, not an hour: the hours of an order expire at one instant and release together, and
-- the handlers (credit and wallet reversal, waitlist advance, the "released" message) run once
-- per order (D45).

-- The definer functions below run as booq_owner (NOLOGIN, runs nothing else). With row level
-- security forced, the owner sees a row only through a policy, so give it one per table, as
-- 0006 did for club. Every definer function filters by app.club_id() itself; the application
-- roles keep their restrictive tenant policy and hold no privilege on these tables.
create policy orders_definer on public.orders for all to booq_owner using (true) with check (true);
create policy booking_definer on public.booking for all to booq_owner using (true) with check (true);
create policy occupancy_definer on public.occupancy for all to booq_owner using (true) with check (true);

-- Handlers other features register: F06 reverses reserved credit and wallet, F08 starts the
-- waitlist advance, F10 enqueues the released message. A handler is (order uuid, reason text).
create table app.release_handlers (
  name text primary key check (name <> ''),
  handler regproc not null,
  ord integer not null
);
alter table app.release_handlers owner to booq_owner;
revoke all on app.release_handlers from public;

create function app.register_release_handler(p_name text, p_handler regproc, p_ord integer) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ insert into app.release_handlers (name, handler, ord) values (p_name, p_handler, p_ord) $$;
alter function app.register_release_handler(text, regproc, integer) owner to booq_owner;
revoke all on function app.register_release_handler(text, regproc, integer) from public;

-- Releases the awaiting hours of one order of the caller's club. Returns true when it released
-- something, false when there was nothing to release (already confirmed or released, expired
-- reason on a live hold, unknown or other club's order), so a second caller is a no-op.
create function app.release_hold(p_order uuid, p_reason text) returns boolean
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
  if p_reason is null or p_reason not in ('expired', 'player', 'closed', 'staff') then
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
  elsif p_reason = 'player' then
    if app.user_id() is null or v_customer is distinct from app.user_id() then
      raise exception 'release not allowed' using errcode = '42501';
    end if;
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

-- The lazy release inside the claim (FA 3.2): before inserting, release every expired hold
-- that overlaps the requested range on the court or on the coach, through release_hold, so a
-- late job blocks nobody. Returns how many orders it released. Called by reserve_court; the
-- application roles cannot call it.
create function app.release_expired_overlapping(p_resource uuid, p_coach uuid, p_start timestamptz, p_end timestamptz)
returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_order uuid;
  v_n integer := 0;
begin
  if v_club is null then
    raise exception 'release_expired_overlapping needs a club in the context' using errcode = '42501';
  end if;
  for v_order in
    select distinct b.order_id
      from public.occupancy o
      join public.booking b on b.club_id = o.club_id and b.id = o.booking_id
     where o.club_id = v_club and o.state = 'held' and o.hold_expires_at <= app.now()
       and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(p_start, p_end, '[)')
       and ((p_resource is not null and o.resource_id = p_resource) or (p_coach is not null and o.coach_id = p_coach))
     order by b.order_id
  loop
    if app.release_hold(v_order, 'expired') then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
alter function app.release_expired_overlapping(uuid, uuid, timestamptz, timestamptz) owner to booq_owner;
revoke all on function app.release_expired_overlapping(uuid, uuid, timestamptz, timestamptz) from public;
-- The test suite calls it as the worker to stand in for reserve_court (which is owned by the
-- same role and needs no grant).
grant execute on function app.release_expired_overlapping(uuid, uuid, timestamptz, timestamptz) to booq_worker;
