-- F07-T09 / migration 0810: the court lock on every F07 occupancy write (FA 3.4 step 3c; BOOK-04-AC1, AC12; rule D159).
-- 0229 added app.lock_resource, a per-court advisory lock taken immediately before an occupancy write, after a deadlock between
-- parallel claims of one court (each waited on the other's uncommitted row). The F07 functions below change an occupancy row
-- (the coach and the kind), and an update that moves the coach re-checks the court's exclusion constraint too, so they take the
-- same lock, in the same place: the coach rows first, the order and booking rows, then the court lock, then the write. The rows
-- they insert (booking_coach_add, coach_substitution) are written before the lock, because a transaction that holds a court
-- lock takes no further lock except the receipt counter. Redefines add_coach_to_booking and f07_release (0806), substitute_coach
-- (0807) and reclaim_coach_add (0809); nothing else changes.

create or replace function app.add_coach_to_booking(p_booking uuid, p_coach uuid, p_order uuid) returns void
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
    insert into public.booking_coach_add (club_id, order_id, booking_id, coach_id, status, hold_expires_at)
    values (v_club, p_order, p_booking, p_coach, case when v_needs then 'pending' else 'confirmed' end,
            case when v_needs then app.now() + make_interval(mins => v_minutes) end);
    perform app.lock_resource(b.resource_id);                  -- step 3c: the court lock, last before the occupancy write
    update public.occupancy set coach_id = p_coach, kind = 'solo_class'
     where club_id = v_club and booking_id = p_booking and resource_id = b.resource_id;
    update public.booking set coach_id = p_coach, type = 'solo_class', updated_at = app.now() where club_id = v_club and id = p_booking;
  exception when exclusion_violation then
    perform app.refuse('coach_unavailable');
  end;
end $$;

create or replace function app.f07_release(p_order uuid, p_reason text) returns void
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
  update public.booking_coach_add set status = 'released', hold_expires_at = null where club_id = v_club and order_id = p_order;
  update public.booking set coach_id = null, type = 'court', updated_at = app.now()
   where club_id = v_club and id = a.booking_id and coach_id = a.coach_id;
  perform app.lock_resource(resource_id) from public.booking where club_id = v_club and id = a.booking_id;   -- step 3c, last before the occupancy write
  update public.occupancy set coach_id = null, kind = 'court_booking'
   where club_id = v_club and booking_id = a.booking_id and coach_id = a.coach_id;
end $$;

create or replace function app.substitute_coach(p_booking uuid, p_new_coach uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  v_old uuid;
  v_code text;
  v_id uuid;
  c uuid;
begin
  if not app.coach_caller_ok(null, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('leave', 'closed_time', 'inactive', 'other') then
    raise exception 'coach: invalid reason' using errcode = 'P0001';
  end if;
  select coach_id into v_old from public.booking where club_id = v_club and id = p_booking;
  if v_old is null then
    perform app.refuse('booking_not_found');
  end if;
  if v_old = p_new_coach then
    perform app.refuse('coach_unavailable');
  end if;
  -- Both coaches in id order (FA 3.4), then the booking.
  for c in select unnest(case when v_old < p_new_coach then array[v_old, p_new_coach] else array[p_new_coach, v_old] end) loop
    perform app.lock_coach(c);
  end loop;
  select * into b from public.booking where club_id = v_club and id = p_booking for update;
  if b.coach_id is distinct from v_old then
    perform app.refuse('not_movable');                                  -- changed under us
  end if;
  if b.start_at <= app.now() then perform app.refuse('hour_started'); end if;
  if b.status <> 'confirmed' or b.type <> 'solo_class' then perform app.refuse('not_movable'); end if;
  v_code := app.coach_check(v_club, p_new_coach, array[b.start_at], p_booking);
  if v_code is not null then perform app.coach_refuse(v_code); end if;
  begin
    insert into public.coach_substitution (club_id, booking_id, from_coach_id, to_coach_id, by_staff_id, reason)
    values (v_club, p_booking, v_old, p_new_coach, app.user_id(), p_reason) returning id into v_id;
    perform app.lock_resource(b.resource_id);                  -- step 3c, last before the occupancy write
    update public.occupancy set coach_id = p_new_coach where club_id = v_club and booking_id = p_booking and coach_id = v_old;
    update public.booking set coach_id = p_new_coach, updated_at = app.now() where club_id = v_club and id = p_booking;
  exception when exclusion_violation then
    perform app.refuse('coach_unavailable');
  end;
  perform app.coach_message_hook('coach_changed', b.customer_id, jsonb_build_object('booking_id', p_booking, 'coach_id', p_new_coach),
                                 'coach_changed:' || p_booking || ':' || p_new_coach);
  perform app.coach_message_hook('session_change', v_old, jsonb_build_object('booking_id', p_booking), 'session_change:' || p_booking || ':' || p_new_coach || ':' || v_old);
  perform app.coach_message_hook('session_change', p_new_coach, jsonb_build_object('booking_id', p_booking), 'session_change:' || p_booking || ':' || p_new_coach || ':' || p_new_coach);
  return v_id;
end $$;

create or replace function app.reclaim_coach_add(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  a public.booking_coach_add%rowtype;
  b public.booking%rowtype;
begin
  if v_club is null then
    raise exception 'reclaim_coach_add needs a club in the context' using errcode = 'P0001';
  end if;
  select * into a from public.booking_coach_add where club_id = v_club and order_id = p_order for update;
  if not found or a.status <> 'released' then
    return false;
  end if;
  perform app.lock_coach(a.coach_id);
  select * into b from public.booking where club_id = v_club and id = a.booking_id for update;
  if b.status <> 'confirmed' or b.type <> 'court' or b.coach_id is not null or b.start_at <= app.now()
     or app.coach_check(v_club, a.coach_id, array[b.start_at], a.booking_id) is not null
     or exists (select 1 from public.booking_coach_add x where x.club_id = v_club and x.booking_id = a.booking_id and x.status in ('pending', 'confirmed')) then
    return false;
  end if;
  begin
    update public.booking_coach_add set status = 'confirmed', hold_expires_at = null where club_id = v_club and order_id = p_order;
    perform app.lock_resource(b.resource_id);                  -- step 3c, last before the occupancy write
    update public.occupancy set coach_id = a.coach_id, kind = 'solo_class' where club_id = v_club and booking_id = a.booking_id;
    update public.booking set coach_id = a.coach_id, type = 'solo_class', updated_at = app.now() where club_id = v_club and id = a.booking_id;
  exception when exclusion_violation then
    return false;
  end;
  return true;
end $$;
