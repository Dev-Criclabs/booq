-- F08-T05b follow-up / migration 0913: app.take_seat counts a Pay tap (D61; orchestrator 30 Oct). Redefines take_seat of 0906 (rule D159).
-- The tap counter is the one reserve_court uses (public.pay_tap, platform config pay_tap_limit_count and pay_tap_limit_window_seconds),
-- checked after the second-tap lookup, so a repeated tap that only returns the player's held seat counts as one tap and a refused tap
-- (class full, wrong audience) is rolled back with its row. With the limit unset nothing is refused, as in reserve_court.
-- 0912 is taken (generate_sessions locks), so this is 0913.

create or replace function app.take_seat(p_order uuid, p_session uuid) returns jsonb
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
  v_tap_count integer;
  v_tap_window integer;
  v_taps integer;
  v_oldest timestamptz;
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
  -- The Pay tap limit (D61): one counter per player, shared with reserve_court, checked after the second-tap lookup. The row is
  -- rolled back with any refusal below, so a refused tap does not count.
  select app.pay_tap_limit_count(), app.pay_tap_limit_window_seconds() into v_tap_count, v_tap_window;
  if v_tap_count is not null and v_tap_window is not null then
    select count(*), min(at) into v_taps, v_oldest
      from public.pay_tap
     where club_id = v_club and user_id = v_user and at > v_now - make_interval(secs => v_tap_window);
    if v_taps >= v_tap_count then
      raise exception 'too_many_attempts' using errcode = 'BK001',
        detail = greatest(1, ceil(extract(epoch from (v_oldest + make_interval(secs => v_tap_window) - v_now))))::integer::text;
    end if;
  end if;
  insert into public.pay_tap (club_id, user_id, at) values (v_club, v_user, v_now);
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
