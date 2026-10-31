-- F08-T06 / migration 0908: the waitlist (CLASS-02-AC1 to AC16, WAIT-01-AC1 to AC5; D44, D121, D157). F08 design 4.8 to 4.12.
-- An offer is a held booking: a class seat (awaiting_payment, no occupancy row) or a court booking with its occupancy row held,
-- made in the transaction that frees the spot, so the slot never shows Open to others while the first in line has a live offer
-- (CLASS-02-AC14, WAIT-01-AC3). The hold ends at the earlier of now + waitlist_claim_minutes and the start (D157, A-6); the claim
-- time is read when the offer is made and stored (CLASS-02-AC13). Settings are never defaulted here: with no waitlist_claim_minutes
-- no offer is made (the spot stays Open); with no waitlist_no_offer_hours no cut off applies.
--   app.join_waitlist(session, resource, slot)  the caller joins a full class (session) or a taken or held court hour (resource,
--       slot): signed in, club open, class_visible, no live seat or booking of their own, the subject full or taken (not_full,
--       not_taken); a repeat returns the live entry. Nothing is charged or held.
--   app.leave_waitlist(entry)  own entry only: waiting becomes left; an offered entry is declined first.
--   app.waitlist_advance(...)  internal (the release handler, cancel flows and the jobs call it): takes the subject lock and, while
--       a spot is free and an entry waits, makes the next offer. Before the cut off only; an open offer stands (AC5, AC15).
--   app.offer_hold(entry)  internal: places the hold for one entry and sets it offered, then enqueues waitlist_offer
--       (offer:{entry}:{offer_no}).
--   app.decline_offer(entry)  the player: declined, never offered this spot again; the hold is released (offer_ended), the next
--       entry is offered, the pending offer message is voided.
--   app.offer_expire(entry)  the offer_expiry job: expired by time; same effects.
--   app.waitlist_pass_on(entry)  F10's sender, when the offer message is undeliverable at the free plan cap (AC9): expired, same effects.
--   a trigger on booking: a seat that becomes live ends the same player's waiting entries for that session (joined_seat); a booking
--       that names an entry and becomes confirmed sets the entry claimed; a session that is back at its minimum voids the pending
--       class_below_minimum message.
-- Lock order (FA 3.4): customer, then the subject (session row, or the advisory lock of the hour), then bookings, then the court lock.

create function app.waitlist_subject_lock(p_resource uuid, p_slot timestamptz) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ select pg_advisory_xact_lock(hashtextextended('waitlist:' || app.club_id()::text || ':' || p_resource::text || ':' || p_slot::text, 0)) $$;
alter function app.waitlist_subject_lock(uuid, timestamptz) owner to booq_owner;
revoke all on function app.waitlist_subject_lock(uuid, timestamptz) from public;

-- Seats taken in a session: confirmed, or held and not ended (a live offer is such a held seat).
create function app.session_taken(p_session uuid) returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select count(*)::integer from public.booking b
       where b.club_id = app.club_id() and b.class_session_id = p_session
         and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now())) $$;
alter function app.session_taken(uuid) owner to booq_owner;
revoke all on function app.session_taken(uuid) from public;

-- Is a court hour held or taken by a booking, a class or a hold (a closure is not "taken": its waiting ends instead)?
create function app.slot_taken(p_resource uuid, p_slot timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select exists (select 1 from public.occupancy o
                      where o.club_id = app.club_id() and o.resource_id = p_resource and o.kind <> 'closure'
                        and o.start_at < p_slot + interval '1 hour' and o.end_at > p_slot
                        and (o.state = 'confirmed' or o.hold_expires_at > app.now())) $$;
alter function app.slot_taken(uuid, timestamptz) owner to booq_owner;
revoke all on function app.slot_taken(uuid, timestamptz) from public;

create function app.join_waitlist(p_session uuid, p_resource uuid default null, p_slot timestamptz default null) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_status text;
  s public.class_session%rowtype;
  v_id uuid;
  v_window text := app.club_setting_text('booking_window_days');
  v_local timestamp;
begin
  if v_club is null then perform app.refuse('club_not_available'); end if;
  if v_user is null or not app.has_any_role('player', 'coach', 'front_desk', 'accountant', 'owner') then perform app.refuse('sign_in_required'); end if;
  select status into v_status from public.club where id = v_club;
  if v_status = 'paused' then perform app.refuse('club_paused'); end if;
  if v_status is null or v_status not in ('live', 'testing') or (v_status = 'testing' and not app.is_club_tester()) then perform app.refuse('club_not_available'); end if;
  if (p_session is null) = (p_resource is null or p_slot is null) then raise exception 'waitlist: name a class or a court hour' using errcode = 'P0001'; end if;

  if p_session is not null then
    select * into s from public.class_session where club_id = v_club and id = p_session;
    if not found or s.status <> 'scheduled' then perform app.refuse('session_not_available'); end if;
    if s.start_at <= app.now() then perform app.refuse('hour_started'); end if;
    if not app.class_visible(p_session, v_user) then perform app.refuse('class_not_for_you'); end if;
    select id into v_id from public.waitlist_entry where club_id = v_club and customer_id = v_user and class_session_id = p_session and status in ('waiting', 'offered');
    if v_id is not null then return v_id; end if;
    -- Under the session row lock, so a seat that frees up between the check and the insert cannot strand the entry.
    select * into s from public.class_session where club_id = v_club and id = p_session for update;
    if exists (select 1 from public.booking b where b.club_id = v_club and b.class_session_id = p_session and b.customer_id = v_user and b.status in ('awaiting_payment', 'confirmed')) then
      perform app.refuse('already_seated');
    end if;
    if app.session_taken(p_session) < s.max_players then perform app.refuse('not_full'); end if;
    begin
      insert into public.waitlist_entry (club_id, customer_id, subject_kind, class_session_id, seq)
      values (v_club, v_user, 'class_session', p_session, app.next_waitlist_seq()) returning id into v_id;
    exception when unique_violation then
      select id into v_id from public.waitlist_entry where club_id = v_club and customer_id = v_user and class_session_id = p_session and status in ('waiting', 'offered');
    end;
    return v_id;
  end if;

  -- A court hour.
  v_local := p_slot at time zone 'Asia/Bangkok';
  if date_trunc('hour', v_local) <> v_local then perform app.refuse('not_on_the_hour'); end if;
  if p_slot <= app.now() then perform app.refuse('in_the_past'); end if;
  if v_window is null or v_window !~ '^[0-9]+$' or v_local::date - (app.now() at time zone 'Asia/Bangkok')::date > v_window::int then perform app.refuse('outside_window'); end if;
  if not exists (select 1 from public.resource where club_id = v_club and id = p_resource and active) then perform app.refuse('resource_inactive'); end if;
  if not exists (select 1 from public.opening_hours oh where oh.club_id = v_club and oh.weekday = extract(isodow from v_local)::int
                  and extract(epoch from v_local::time) >= extract(epoch from oh.open) and extract(epoch from v_local::time) + 3600 <= extract(epoch from oh.close)) then
    perform app.refuse('outside_hours');
  end if;
  select id into v_id from public.waitlist_entry where club_id = v_club and customer_id = v_user and resource_id = p_resource and slot_start_at = p_slot and status in ('waiting', 'offered');
  if v_id is not null then return v_id; end if;
  perform app.waitlist_subject_lock(p_resource, p_slot);
  if exists (select 1 from public.booking b where b.club_id = v_club and b.customer_id = v_user and b.start_at = p_slot and b.status in ('awaiting_payment', 'confirmed')) then
    perform app.refuse('already_booked');
  end if;
  if not app.slot_taken(p_resource, p_slot) then perform app.refuse('not_taken'); end if;
  begin
    insert into public.waitlist_entry (club_id, customer_id, subject_kind, resource_id, slot_start_at, seq)
    values (v_club, v_user, 'court_slot', p_resource, p_slot, app.next_waitlist_seq()) returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.waitlist_entry where club_id = v_club and customer_id = v_user and resource_id = p_resource and slot_start_at = p_slot and status in ('waiting', 'offered');
  end;
  return v_id;
end $$;

-- Ends an offer's side effects in one place: the held booking is released, the pending offer message voided.
create function app.end_offer(p_entry uuid, p_status text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  e public.waitlist_entry%rowtype;
  v_order uuid;
begin
  select * into e from public.waitlist_entry where club_id = v_club and id = p_entry for update;
  if not found or e.status <> 'offered' then return; end if;
  -- The entry first, so the release handler that runs inside release_hold finds it ended and does not end it again.
  update public.waitlist_entry set status = p_status where club_id = v_club and id = p_entry;
  perform app.void_messages('offer:' || p_entry || ':', 'cancelled');
  select order_id into v_order from public.booking where club_id = v_club and id = e.offer_booking_id;
  if v_order is not null then
    perform app.release_hold(v_order, 'offer_ended');
  end if;
end $$;
alter function app.end_offer(uuid, text) owner to booq_owner;
revoke all on function app.end_offer(uuid, text) from public;

create function app.offer_hold(p_entry uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  e public.waitlist_entry%rowtype;
  s public.class_session%rowtype;
  v_minutes text := app.club_setting_text('waitlist_claim_minutes');
  v_start timestamptz;
  v_expires timestamptz;
  v_order uuid;
  v_booking uuid;
begin
  select * into e from public.waitlist_entry where club_id = v_club and id = p_entry for update;
  if not found or e.status <> 'waiting' then return null; end if;
  if v_minutes is null or v_minutes !~ '^[0-9]+$' or v_minutes::int = 0 then return null; end if;
  if e.class_session_id is not null then
    select * into s from public.class_session where club_id = v_club and id = e.class_session_id;
    v_start := s.start_at;
  else
    v_start := e.slot_start_at;
  end if;
  v_expires := least(app.now() + make_interval(mins => v_minutes::int), v_start);
  if v_expires <= app.now() then return null; end if;
  insert into public.orders (club_id, customer_id, source) values (v_club, e.customer_id, 'online') returning id into v_order;
  begin
    if e.class_session_id is not null then
      insert into public.booking (club_id, order_id, type, resource_id, class_session_id, waitlist_entry_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
      values (v_club, v_order, 'class_seat', s.resource_id, s.id, e.id, s.start_at, s.end_at, e.customer_id, 'awaiting_payment', 'online', e.customer_id, v_expires)
      returning id into v_booking;
    else
      insert into public.booking (club_id, order_id, type, resource_id, waitlist_entry_id, start_at, end_at, customer_id, status, source, created_by, hold_expires_at)
      values (v_club, v_order, 'court', e.resource_id, e.id, e.slot_start_at, e.slot_start_at + interval '1 hour', e.customer_id, 'awaiting_payment', 'online', e.customer_id, v_expires)
      returning id into v_booking;
      perform app.lock_resource(e.resource_id);                 -- step 3c, last before the occupancy write
      insert into public.occupancy (club_id, kind, resource_id, start_at, end_at, state, hold_expires_at, booking_id)
      values (v_club, 'court_booking', e.resource_id, e.slot_start_at, e.slot_start_at + interval '1 hour', 'held', v_expires, v_booking);
    end if;
  exception when exclusion_violation or unique_violation then
    return null;                                               -- the hold was refused: nothing is offered, the entry stays waiting
  end;
  update public.waitlist_entry set status = 'offered', offer_no = e.offer_no + 1, offered_at = app.now(), offer_expires_at = v_expires, offer_booking_id = v_booking
   where club_id = v_club and id = e.id;
  perform app.enqueue_message('waitlist_offer', e.customer_id,
          jsonb_build_object('entry_id', e.id, 'offer_no', e.offer_no + 1, 'session_id', e.class_session_id, 'resource_id', e.resource_id, 'slot_start_at', e.slot_start_at),
          'offer:' || e.id || ':' || (e.offer_no + 1), app.now());
  return v_booking;
end $$;
alter function app.offer_hold(uuid) owner to booq_owner;
revoke all on function app.offer_hold(uuid) from public;

create function app.waitlist_advance(p_session uuid, p_resource uuid default null, p_slot timestamptz default null) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s public.class_session%rowtype;
  v_cut text := app.club_setting_text('waitlist_no_offer_hours');
  v_start timestamptz;
  v_free boolean;
  v_entry uuid;
  v_made integer := 0;
begin
  if v_club is null then
    raise exception 'waitlist_advance needs a club in the context' using errcode = '42501';
  end if;
  if p_session is not null then
    select * into s from public.class_session where club_id = v_club and id = p_session for update;   -- the subject lock
    if not found or s.status <> 'scheduled' then return 0; end if;
    v_start := s.start_at;
  else
    if p_resource is null or p_slot is null then return 0; end if;
    perform app.waitlist_subject_lock(p_resource, p_slot);
    v_start := p_slot;
  end if;
  if v_start <= app.now() then return 0; end if;
  -- Cut off: no new offers close to the start; an offer already open stands (CLASS-02-AC5, AC15).
  if v_cut ~ '^[0-9]+(\.[0-9]+)?$' and v_start - app.now() < v_cut::numeric * interval '1 hour' then return 0; end if;
  loop
    if p_session is not null then
      v_free := app.session_taken(p_session) < s.max_players;
    else
      v_free := not app.slot_taken(p_resource, p_slot)
                and not exists (select 1 from public.occupancy o where o.club_id = v_club and o.resource_id = p_resource and o.kind = 'closure'
                                  and o.start_at < p_slot + interval '1 hour' and o.end_at > p_slot)
                and exists (select 1 from public.resource r join public.opening_hours oh on oh.club_id = r.club_id and oh.weekday = extract(isodow from (p_slot at time zone 'Asia/Bangkok'))::int
                             where r.club_id = v_club and r.id = p_resource and r.active
                               and extract(epoch from ((p_slot at time zone 'Asia/Bangkok')::time)) >= extract(epoch from oh.open)
                               and extract(epoch from ((p_slot at time zone 'Asia/Bangkok')::time)) + 3600 <= extract(epoch from oh.close));
    end if;
    exit when not v_free;
    -- The first waiting entry whose player is free to take the spot; a skipped player keeps their place.
    select w.id into v_entry from public.waitlist_entry w
     where w.club_id = v_club and w.status = 'waiting'
       and ((p_session is not null and w.class_session_id = p_session) or (p_session is null and w.resource_id = p_resource and w.slot_start_at = p_slot))
       and not exists (select 1 from public.booking b where b.club_id = v_club and b.customer_id = w.customer_id and b.status in ('awaiting_payment', 'confirmed')
                         and ((p_session is not null and b.class_session_id = p_session) or (p_session is null and b.start_at = p_slot)))
       and not exists (select 1 from public.waitlist_entry o where o.club_id = v_club and o.customer_id = w.customer_id and o.status = 'offered' and o.id <> w.id
                         and coalesce((select cs.start_at from public.class_session cs where cs.club_id = v_club and cs.id = o.class_session_id), o.slot_start_at) = v_start)
     order by w.seq limit 1;
    exit when v_entry is null;
    exit when app.offer_hold(v_entry) is null;
    v_made := v_made + 1;
  end loop;
  return v_made;
end $$;
alter function app.waitlist_advance(uuid, uuid, timestamptz) owner to booq_owner;
revoke all on function app.waitlist_advance(uuid, uuid, timestamptz) from public;

-- Passing on: end the offer, then offer the spot to the next in line.
create function app.pass_offer_on(p_entry uuid, p_status text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  e public.waitlist_entry%rowtype;
begin
  select * into e from public.waitlist_entry where club_id = v_club and id = p_entry;
  if not found or e.status <> 'offered' then return; end if;
  perform app.end_offer(p_entry, p_status);
  perform app.waitlist_advance(e.class_session_id, e.resource_id, e.slot_start_at);
end $$;
alter function app.pass_offer_on(uuid, text) owner to booq_owner;
revoke all on function app.pass_offer_on(uuid, text) from public;

create function app.leave_waitlist(p_entry uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  e public.waitlist_entry%rowtype;
begin
  if v_club is null or app.user_id() is null then perform app.refuse('sign_in_required'); end if;
  select * into e from public.waitlist_entry where club_id = v_club and id = p_entry and customer_id = app.user_id();
  if not found then perform app.refuse('entry_not_found'); end if;
  if e.status = 'offered' then
    perform app.pass_offer_on(p_entry, 'declined');
  elsif e.status = 'waiting' then
    update public.waitlist_entry set status = 'left', ended_reason = 'left' where club_id = v_club and id = p_entry and status = 'waiting';
  end if;
end $$;

create function app.decline_offer(p_entry uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or app.user_id() is null then perform app.refuse('sign_in_required'); end if;
  if not exists (select 1 from public.waitlist_entry where club_id = v_club and id = p_entry and customer_id = app.user_id() and status = 'offered') then
    perform app.refuse('entry_not_found');
  end if;
  perform app.pass_offer_on(p_entry, 'declined');
end $$;

create function app.offer_expire(p_entry uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.waitlist_entry where club_id = v_club and id = p_entry and status = 'offered' and offer_expires_at <= app.now()) then
    return false;
  end if;
  perform app.pass_offer_on(p_entry, 'expired');
  return true;
end $$;

create function app.waitlist_pass_on(p_entry uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.waitlist_entry where club_id = v_club and id = p_entry and status = 'offered') then
    return false;
  end if;
  perform app.pass_offer_on(p_entry, 'expired');
  return true;
end $$;

-- Offers due, across clubs, for the job (as app.due_hold_orders).
create function app.due_offers(p_limit integer default 200) returns table (club_id uuid, entry_id uuid, lag_seconds integer)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select w.club_id, w.id, greatest(0, extract(epoch from (app.now() - w.offer_expires_at)))::integer
                 from public.waitlist_entry w where w.status = 'offered' and w.offer_expires_at <= app.now()
                order by w.offer_expires_at, w.id limit greatest(1, p_limit);
end $$;

-- The booking trigger.
create function app.seat_live_effects() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  s public.class_session%rowtype;
begin
  if new.class_session_id is not null and new.status in ('awaiting_payment', 'confirmed') then
    -- The player has a seat: the other waiting entries of theirs for the session are over.
    update public.waitlist_entry set status = 'ended', ended_reason = 'joined_seat'
     where club_id = new.club_id and class_session_id = new.class_session_id and customer_id = new.customer_id and status = 'waiting'
       and id is distinct from new.waitlist_entry_id;       -- the entry this very booking is the offer of stays
    select * into s from public.class_session where club_id = new.club_id and id = new.class_session_id;
    if found and (select count(*) from public.booking b where b.club_id = new.club_id and b.class_session_id = new.class_session_id
                    and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now()))) >= s.min_players then
      -- Back at the minimum: the alert is no longer true. Written straight to the outbox (as app.void_messages does) because a
      -- trigger runs for the row's own club whether or not the writer set a club context.
      update public.message_outbox set status = 'void', void_reason = 'superseded'
       where club_id = new.club_id and status = 'pending' and dedupe_key = 'below_min:' || new.class_session_id::text;
    end if;
  end if;
  if new.waitlist_entry_id is not null and new.status = 'confirmed' then
    update public.waitlist_entry set status = 'claimed' where club_id = new.club_id and id = new.waitlist_entry_id and status = 'offered';
    update public.message_outbox set status = 'void', void_reason = 'cancelled'
     where club_id = new.club_id and status = 'pending' and left(dedupe_key, length('offer:' || new.waitlist_entry_id::text || ':')) = 'offer:' || new.waitlist_entry_id::text || ':';
  end if;
  return null;
end $$;
alter function app.seat_live_effects() owner to booq_owner;
revoke all on function app.seat_live_effects() from public;
create trigger booking_seat_live_effects after insert or update of status on public.booking
  for each row when (new.class_session_id is not null or new.waitlist_entry_id is not null) execute function app.seat_live_effects();

do $$
declare f text;
begin
  foreach f in array array['app.join_waitlist(uuid, uuid, timestamptz)', 'app.leave_waitlist(uuid)', 'app.decline_offer(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
  foreach f in array array['app.offer_expire(uuid)', 'app.waitlist_pass_on(uuid)', 'app.due_offers(integer)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_worker', f);
  end loop;
end $$;
