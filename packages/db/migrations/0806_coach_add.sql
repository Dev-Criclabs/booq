-- F07-T06 / migration 0806: Add a coach to an existing booking (COACH-03, R5-AC1, AC2, R6-AC1 to AC3, BOOK-04-AC2, AC3, D111).
-- F07 design 4.1 and 5.5. The coaching portion is its own order (priced by F04, paid by F05, its own receipt). The coach is
-- claimed on the booking's existing occupancy row at once, so the coach is held while the player pays (CC-4), and the
-- exclusion constraint of the coach is the final guard. booking_coach_add records which order owns that hold.
--   booking_coach_add(club, order, booking, coach, status pending|confirmed|released, hold_expires_at, created_at)
--       hold_expires_at is not in the design 4.1 list: the booking is already confirmed, so the hold of the add order
--       cannot live on a booking row (booking.hold_expires_at is only for awaiting_payment). It is null once decided.
--   app.add_coach_to_booking(booking, coach, order)   the booking's player on their own booking, or staff (also in a
--       Paused club). A free coach is claimed; a busy one answers coach_unavailable or rest_rule and nothing changes.
--       An add order that needs no payment is confirmed at once.
--   app.confirm_coach_add(order)       payment path (worker or staff): pending add whose hold runs -> confirmed. false when none.
--   app.release_coach_add(order, why)  the add order's counterpart of release_hold: same reasons and callers; runs the
--       release handlers, among them app.f07_release (ord 35), which reverts booking and occupancy to a court booking.
--   app.due_coach_add_orders(limit)    the worker's list of add orders whose hold ended.
-- The payment path and the hold job reach these through apply_payment and the hold_release job (F07-T06b).

create table public.booking_coach_add (
  club_id uuid not null,
  order_id uuid not null,
  booking_id uuid not null,
  coach_id uuid not null,
  status text not null default 'pending',
  hold_expires_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, order_id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  constraint booking_coach_add_status_values check (status in ('pending', 'confirmed', 'released')),
  constraint booking_coach_add_hold_matches check ((status = 'pending') = (hold_expires_at is not null))
);
-- One live add per booking: a second coach on the same hour is refused by the database as well.
create unique index booking_coach_add_one_live on public.booking_coach_add (club_id, booking_id) where status in ('pending', 'confirmed');
create index booking_coach_add_hold on public.booking_coach_add (hold_expires_at) where status = 'pending';

alter table public.booking_coach_add owner to booq_owner;
alter table public.booking_coach_add enable row level security;
alter table public.booking_coach_add force row level security;
revoke all on public.booking_coach_add from public;
create policy booking_coach_add_tenant on public.booking_coach_add as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy booking_coach_add_definer on public.booking_coach_add for all to booq_owner using (true) with check (true);
create trigger is_test_copy before insert on public.booking_coach_add for each row execute function app.copy_coach_is_test();
select app.register_test_table('public.booking_coach_add', 95, false);
select audit.register('public.booking_coach_add', array['order_id']);

create function app.add_coach_to_booking(p_booking uuid, p_coach uuid, p_order uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_status text;
  v_minutes integer;
  v_code text;
  b public.booking%rowtype;
  o public.orders%rowtype;
  v_needs boolean;
begin
  if v_club is null or app.user_id() is null then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;
  select c.status into v_status from public.club c where c.id = v_club;
  if v_status = 'paused' and not v_staff then perform app.refuse('club_paused'); end if;
  if v_status not in ('live', 'paused', 'testing') then perform app.refuse('club_not_available'); end if;

  -- Lock order (FA 3.4): the coach first, then the order, then the booking and its occupancy row.
  perform app.lock_coach(p_coach);
  select * into o from public.orders where club_id = v_club and id = p_order for update;
  select * into b from public.booking where club_id = v_club and id = p_booking for update;
  if b.id is null or o.id is null or (b.customer_id is distinct from app.user_id() and not v_staff) then
    perform app.refuse('booking_not_found');                   -- missing and not yours look the same
  end if;
  if b.start_at <= app.now() then perform app.refuse('hour_started'); end if;
  if b.status <> 'confirmed' or b.type <> 'court' or b.coach_id is not null then
    perform app.refuse('not_movable');
  end if;
  if o.status <> 'open' or o.priced_at is null or o.kind <> 'sale' or o.customer_id is distinct from b.customer_id
     or exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.order_id = p_order) then
    perform app.refuse('order_not_found');
  end if;
  if exists (select 1 from public.booking_coach_add a where a.club_id = v_club and a.booking_id = p_booking and a.status in ('pending', 'confirmed')) then
    perform app.refuse('coach_unavailable');
  end if;
  v_code := app.coach_check(v_club, p_coach, array[b.start_at], p_booking);
  if v_code is not null then perform app.coach_refuse(v_code); end if;

  v_needs := app.order_needs_payment(p_order);
  if v_needs then
    v_minutes := app.hold_minutes();
    if v_minutes is null then perform app.refuse('hold_setting_unset'); end if;
  end if;
  begin
    update public.occupancy set coach_id = p_coach, kind = 'solo_class'
     where club_id = v_club and booking_id = p_booking and resource_id = b.resource_id;
    update public.booking set coach_id = p_coach, type = 'solo_class', updated_at = app.now() where club_id = v_club and id = p_booking;
  exception when exclusion_violation then
    perform app.refuse('coach_unavailable');
  end;
  insert into public.booking_coach_add (club_id, order_id, booking_id, coach_id, status, hold_expires_at)
  values (v_club, p_order, p_booking, p_coach, case when v_needs then 'pending' else 'confirmed' end,
          case when v_needs then app.now() + make_interval(mins => v_minutes) end);
end $$;

create function app.confirm_coach_add(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_club uuid := app.club_id();
begin
  if v_club is null
     or not (coalesce(current_setting('role', true), '') = 'booq_worker' or app.has_any_role('owner', 'front_desk')) then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;
  update public.booking_coach_add set status = 'confirmed', hold_expires_at = null
   where club_id = v_club and order_id = p_order and status = 'pending' and hold_expires_at > app.now();
  return found;
end $$;

-- The revert, run as a release handler (design 5.5 step 4): the court booking is unchanged.
create function app.f07_release(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  a public.booking_coach_add%rowtype;
begin
  if v_club is null then
    raise exception 'f07_release needs a club in the context' using errcode = 'P0001';
  end if;
  select * into a from public.booking_coach_add where club_id = v_club and order_id = p_order and status = 'pending' for update;
  if not found then
    return;
  end if;
  update public.occupancy set coach_id = null, kind = 'court_booking'
   where club_id = v_club and booking_id = a.booking_id and coach_id = a.coach_id;
  update public.booking set coach_id = null, type = 'court', updated_at = app.now()
   where club_id = v_club and id = a.booking_id and coach_id = a.coach_id;
  update public.booking_coach_add set status = 'released', hold_expires_at = null where club_id = v_club and order_id = p_order;
end $$;

create function app.release_coach_add(p_order uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_worker boolean := coalesce(current_setting('role', true), '') = 'booq_worker';
  a public.booking_coach_add%rowtype;
  v_customer uuid;
  h record;
begin
  if v_club is null then
    raise exception 'release_coach_add needs a club in the context' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('expired', 'player', 'closed', 'staff', 'payment_unavailable', 'offer_ended') then
    raise exception 'unknown release reason' using errcode = '22023';
  end if;
  select * into a from public.booking_coach_add where club_id = v_club and order_id = p_order and status = 'pending' for update;
  if not found then
    return false;
  end if;
  select customer_id into v_customer from public.booking where club_id = v_club and id = a.booking_id;
  if p_reason = 'expired' then
    if a.hold_expires_at > app.now() then return false; end if;
  elsif p_reason in ('player', 'payment_unavailable', 'offer_ended') then
    if not (v_staff or v_worker) and (app.user_id() is null or v_customer is distinct from app.user_id()) then
      raise exception 'release not allowed' using errcode = '42501';
    end if;
  elsif not (v_staff or (p_reason = 'closed' and v_worker)) then
    raise exception 'release not allowed' using errcode = '42501';
  end if;
  for h in select handler from app.release_handlers order by ord, name loop
    execute format('select %s($1, $2)', h.handler) using p_order, p_reason;
  end loop;
  return true;
end $$;

create function app.due_coach_add_orders(p_limit integer default 200)
returns table (club_id uuid, order_id uuid, lag_seconds integer)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select a.club_id, a.order_id, greatest(0, extract(epoch from (app.now() - a.hold_expires_at)))::integer
      from public.booking_coach_add a
     where a.status = 'pending' and a.hold_expires_at <= app.now()
     order by a.hold_expires_at, a.order_id
     limit greatest(1, p_limit);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.add_coach_to_booking(uuid, uuid, uuid)', 'app.confirm_coach_add(uuid)', 'app.f07_release(uuid, text)',
                           'app.release_coach_add(uuid, text)', 'app.due_coach_add_orders(integer)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;
grant execute on function app.add_coach_to_booking(uuid, uuid, uuid) to booq_app;
grant execute on function app.confirm_coach_add(uuid) to booq_app, booq_worker;
grant execute on function app.release_coach_add(uuid, text) to booq_app, booq_worker;
grant execute on function app.due_coach_add_orders(integer) to booq_worker;
select app.register_release_handler('f07_coach_add', 'app.f07_release(uuid, text)'::regprocedure::regproc, 35);
