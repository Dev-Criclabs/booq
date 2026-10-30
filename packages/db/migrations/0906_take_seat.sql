-- F08-T05b / migration 0906: app.take_seat, the only way a seat is made (CLASS-01-AC4, AC14, AC15, AC17; CC-4). F08 design 3.3, 4.4.
-- Called by Pay in the order's transaction, as reserve_court is for an hour. app.take_seat(order, session) returns
-- {order_id, booking_ids: [seat], hold_expires_at, reused}. The customer is the order's customer: the caller's own order, or
-- any order of the club for owner and front desk. In order:
--   1. context: signed in; a Paused club refuses (club_paused), a Draft or Testing club only for its testers;
--   2. the order is this club's and the caller's (order_not_found otherwise);
--   3. the session is this club's, scheduled and not started (session_not_available, hour_started);
--   4. app.class_visible(session, customer) (class_not_for_you; a class hidden from a player is refused, CC-2);
--   5. lock order (FA 3.4): the customer's advisory lock; this customer's expired held seat in the session is released through
--      release_hold; then the session row FOR UPDATE; then the count. A second tap by the same player returns the live held seat
--      and its first hold_expires_at (D47, F03 D46); an order that needs no payment gets a confirmed seat at once;
--   6. capacity under the session row lock: taken = confirmed seats + held seats whose hold has not ended (a live offer is such a
--      held seat, so offers need no term of their own); taken >= max_players is session_full;
--   7. the seat is a booking of type class_seat on the session's court with no coach, named session, status awaiting_payment with
--      hold_expires_at = now + hold_minutes (one instant, never changed) or confirmed. A seat writes no occupancy row: the
--      session already holds court and coach. The unique index of 0903 turns a second live seat of one player into already_seated.
-- A seat is a one hour booking of its player (BOOK-06) and does not count toward the future court hours (D59).

create function app.take_seat(p_order uuid, p_session uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_now timestamptz := app.now();
  v_staff boolean := app.has_any_role('owner', 'front_desk');
  v_status text;
  o public.orders%rowtype;
  s public.class_session%rowtype;
  v_pay boolean;
  v_minutes integer;
  v_expires timestamptz;
  v_existing public.booking%rowtype;
  v_expired uuid;
  v_taken integer;
  v_id uuid;
begin
  -- 1. Context.
  if v_club is null then perform app.refuse('club_not_available'); end if;
  if v_user is null or not app.has_any_role('player', 'coach', 'front_desk', 'accountant', 'owner') then
    perform app.refuse('sign_in_required');
  end if;
  select status into v_status from public.club where id = v_club;
  if v_status is null then perform app.refuse('club_not_available'); end if;
  if v_status = 'paused' then perform app.refuse('club_paused'); end if;
  if v_status in ('draft', 'testing') and not app.is_club_tester() then perform app.refuse('club_not_available'); end if;
  if v_status not in ('draft', 'testing', 'live') then perform app.refuse('club_not_available'); end if;

  -- 2. The order.
  select * into o from public.orders where club_id = v_club and id = p_order;
  if not found or (not v_staff and (o.customer_id is distinct from v_user or o.source <> 'online')) then
    perform app.refuse('order_not_found');
  end if;

  -- 3. The session.
  select * into s from public.class_session where club_id = v_club and id = p_session;
  if not found or s.status <> 'scheduled' then perform app.refuse('session_not_available'); end if;
  if s.start_at <= v_now then perform app.refuse('hour_started'); end if;

  -- 4. Audience.
  if not app.class_visible(p_session, o.customer_id) then perform app.refuse('class_not_for_you'); end if;

  -- 5. Locks: the customer first.
  perform app.lock_customer(o.customer_id);
  -- Second tap: the player's own live held seat for this session comes back with its first hold.
  select * into v_existing from public.booking b
   where b.club_id = v_club and b.class_session_id = p_session and b.customer_id = o.customer_id and b.status = 'awaiting_payment'
     and b.hold_expires_at > v_now and b.created_by = v_user;
  if found then
    return jsonb_build_object('order_id', v_existing.order_id, 'booking_ids', jsonb_build_array(v_existing.id),
                              'hold_expires_at', v_existing.hold_expires_at, 'reused', true);
  end if;
  -- An expired hold of this player in this session is released first, so the unique seat index does not block them.
  for v_expired in
    select distinct b.order_id from public.booking b
     where b.club_id = v_club and b.class_session_id = p_session and b.customer_id = o.customer_id
       and b.status = 'awaiting_payment' and b.hold_expires_at <= v_now
  loop
    perform app.release_hold(v_expired, 'expired');
  end loop;

  v_pay := app.order_needs_payment(p_order);
  if v_pay then
    v_minutes := app.hold_minutes();
    if v_minutes is null then perform app.refuse('hold_setting_unset'); end if;
    v_expires := v_now + make_interval(mins => v_minutes);
  end if;

  -- 6. Capacity under the session row lock.
  select * into s from public.class_session where club_id = v_club and id = p_session for update;
  if s.status <> 'scheduled' then perform app.refuse('session_not_available'); end if;
  select count(*) into v_taken from public.booking b
   where b.club_id = v_club and b.class_session_id = p_session
     and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > v_now));
  if v_taken >= s.max_players then perform app.refuse('session_full'); end if;

  -- 7. The seat.
  begin
    insert into public.booking (club_id, order_id, type, resource_id, class_session_id, start_at, end_at, customer_id, status, source,
                                created_by, hold_expires_at, confirmed_at)
    values (v_club, p_order, 'class_seat', s.resource_id, p_session, s.start_at, s.end_at, o.customer_id,
            case when v_pay then 'awaiting_payment' else 'confirmed' end, o.source,
            v_user, v_expires, case when v_pay then null else v_now end)
    returning id into v_id;
  exception when unique_violation then
    perform app.refuse('already_seated');
  end;
  return jsonb_build_object('order_id', p_order, 'booking_ids', jsonb_build_array(v_id), 'hold_expires_at', v_expires);
end $$;
alter function app.take_seat(uuid, uuid) owner to booq_owner;
revoke all on function app.take_seat(uuid, uuid) from public;
grant execute on function app.take_seat(uuid, uuid) to booq_app, booq_worker;
