-- F10-T06 / migration 0605: the message functions. F10 design 5.1, 5.2, 5.4, 5.9; FA 5.3, 5.6.
-- Requirements LINE-03, LINE-05, LINE-07-AC1 to AC4, PDPA-01-AC5, CC-3; decision D96; Architect review of 30 Oct
-- (the fifth payment port; booking_released skips payment_unavailable) and F03-T30 (it skips offer_ended too).
--   app.message_kinds                the catalogue of design 5.4: which kinds exist, which are reminders, which switch
--   app.enqueue_message(...)         the only way a message is created; the fifth payment port
--   app.cap_state()                  normal, alert, reminders_stopped or over_limit, derived for the caller's club
--   app.void_messages(prefix, why)   voids pending rows by dedupe key prefix (a cancel, a move, an extension)
--   app.void_cap_reminders()         at 80 percent and over, voids the club's pending reminders (never revived)
--   app.mark_undeliverable(id, err)  the sender's end for a free plan at 100 percent or a LINE 429
--   app.f10_released(order, reason)  release handler: booking_released, except for payment_unavailable, offer_ended
--   app.f10_anonymise(club, user)    clears the person's message params (migration 0019)
-- All take the club from app.club_id() (or the handler's argument from the caller that holds it), are SECURITY
-- DEFINER with a fixed search path and are run by the worker; other features' definer functions call them as owner.

-- The catalogue (F10 design 5.4). cap_class R: a reminder, dropped at 80 percent (LINE-07); A: always sent, except
-- that on a free plan at 100 percent it is undeliverable. switch_key: the C17 switch that controls it (D94).
create table app.message_kinds (
  kind text primary key check (kind ~ '^[a-z][a-z0-9_]*$'),
  cap_class text not null check (cap_class in ('R', 'A')),
  switch_key text check (switch_key in ('reminders', 'promotions'))
);
alter table app.message_kinds owner to booq_owner;
revoke all on app.message_kinds from public;
insert into app.message_kinds (kind, cap_class, switch_key) values
  ('booking_confirmed', 'A', null),
  ('booking_released', 'A', null),
  ('reminder_24h', 'R', 'reminders'),
  ('reminder_2h', 'R', 'reminders'),
  ('cancellation_result', 'A', null),
  ('club_closed_slot', 'A', null),
  ('coach_changed', 'A', null),
  ('waitlist_offer', 'A', null),
  ('package_expiring', 'A', null),
  ('birthday_discount', 'A', 'promotions'),
  ('referral_reward', 'A', 'promotions'),
  ('session_change', 'A', null),
  ('leave_decision', 'A', null),
  ('class_below_minimum', 'A', null),
  ('late_payment', 'A', null),
  ('wrong_amount', 'A', null),
  ('owner_paused', 'A', null),
  ('owner_cap_paid_over', 'A', null);
alter table public.message_outbox add constraint message_outbox_kind_fkey foreign key (kind) references app.message_kinds (kind);

-- The cap state of the caller's club for this Bangkok calendar month (FA 5.6). No usage row or no known limit:
-- normal (and line_health reports that the cap cannot be computed). Thresholds from platform.config (0604).
create function app.cap_state() returns text
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  u platform.club_line_usage%rowtype;
  v_pct numeric;
begin
  if v_club is null then
    raise exception 'cap_state needs a club in the context' using errcode = '42501';
  end if;
  select * into u from platform.club_line_usage
   where club_id = v_club and month = date_trunc('month', app.now() at time zone 'Asia/Bangkok')::date;
  if not found or u.message_limit is null then
    return 'normal';
  end if;
  v_pct := u.used * 100.0 / u.message_limit;
  if v_pct >= (select (value #>> '{}')::numeric from platform.config where key = 'line_cap_over_limit_percent') then
    return 'over_limit';
  elsif v_pct >= (select (value #>> '{}')::numeric from platform.config where key = 'line_cap_reminders_stop_percent') then
    return 'reminders_stopped';
  elsif v_pct >= (select (value #>> '{}')::numeric from platform.config where key = 'line_cap_alert_percent') then
    return 'alert';
  end if;
  return 'normal';
end $$;

-- Inserts one outbox row in the caller's transaction and returns its id; a repeat of the dedupe key returns the
-- existing id, whatever its status (a voided reminder is never revived). Returns null and creates nothing when
-- there is no recipient (a walk-in order) or the recipient is not a person of the club, or for a reminder whose hour has passed or at 80 percent and over (D96,
-- FA 5.4, 5.6 step 1). On a free plan at 100 percent the row is created undeliverable (FA 5.6 step 4), so the
-- caller (F08's offer) can see at once that it cannot be sent. is_test comes from the club status trigger (D32).
create function app.enqueue_message(p_kind text, p_user uuid, p_params jsonb, p_dedupe_key text, p_send_at timestamptz)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_class text;
  v_state text;
  v_send_at timestamptz := coalesce(p_send_at, app.now());
  v_id uuid;
begin
  if v_club is null then
    raise exception 'enqueue_message needs a club in the context' using errcode = '42501';
  end if;
  select cap_class into v_class from app.message_kinds where kind = p_kind;
  if v_class is null then
    raise exception 'enqueue_message: unknown message kind %', p_kind using errcode = '22023';
  end if;
  if p_dedupe_key is null or p_dedupe_key = '' then
    raise exception 'enqueue_message: a dedupe key is required' using errcode = '22023';
  end if;
  -- No recipient, or not a person of this club: nothing to send, and the business transaction goes on (design 10).
  if p_user is null or not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = p_user) then
    return null;
  end if;
  select id into v_id from public.message_outbox where club_id = v_club and dedupe_key = p_dedupe_key;
  if v_id is not null then
    return v_id;
  end if;
  v_state := app.cap_state();
  if v_class = 'R' and (v_send_at <= app.now() or v_state in ('reminders_stopped', 'over_limit')) then
    return null;
  end if;
  insert into public.message_outbox (club_id, user_id, kind, params, dedupe_key, send_at, status, last_error)
  select v_club, p_user, p_kind, coalesce(p_params, '{}'), p_dedupe_key, v_send_at,
         case when free then 'undeliverable' else 'pending' end, case when free then 'cap' end
    from (select v_state = 'over_limit' and exists (
                   select 1 from platform.club_line_usage u
                    where u.club_id = v_club and u.month = date_trunc('month', app.now() at time zone 'Asia/Bangkok')::date
                      and u.plan_kind = 'free') as free) f
  on conflict (club_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.message_outbox where club_id = v_club and dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end $$;

-- Voids the club's pending messages whose dedupe key starts with the prefix, for example 'reminder:{booking}:' when
-- a booking is cancelled or moved, or 'package_expiring:{package}:' before the new expiry's rows are queued.
create function app.void_messages(p_dedupe_prefix text, p_reason text) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_n integer;
begin
  if v_club is null then
    raise exception 'void_messages needs a club in the context' using errcode = '42501';
  end if;
  if p_dedupe_prefix is null or p_dedupe_prefix = '' then
    raise exception 'void_messages: a dedupe key prefix is required' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('cancelled', 'moved', 'cap', 'switch_off', 'no_credits', 'superseded') then
    raise exception 'void_messages: unknown void reason %', p_reason using errcode = '22023';
  end if;
  update public.message_outbox
     set status = 'void', void_reason = p_reason
   where club_id = v_club and status = 'pending' and left(dedupe_key, length(p_dedupe_prefix)) = p_dedupe_prefix;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- At 80 percent and over, every pending reminder of the club is voided with reason cap (LINE-07-AC2, FA 5.6
-- step 2). Void is final, so a later drop or a new month does not bring them back.
create function app.void_cap_reminders() returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_n integer := 0;
begin
  if v_club is null then
    raise exception 'void_cap_reminders needs a club in the context' using errcode = '42501';
  end if;
  if app.cap_state() in ('reminders_stopped', 'over_limit') then
    update public.message_outbox o
       set status = 'void', void_reason = 'cap'
     where o.club_id = v_club and o.status = 'pending'
       and o.kind in (select k.kind from app.message_kinds k where k.cap_class = 'R');
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end $$;

-- Ends a pending message as undeliverable with an error code (cap, or a LINE answer the sender cannot retry).
-- Returns false when the row is not pending (already ended).
create function app.mark_undeliverable(p_message uuid, p_error text) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null then
    raise exception 'mark_undeliverable needs a club in the context' using errcode = '42501';
  end if;
  if p_error is null or p_error = '' then
    raise exception 'mark_undeliverable: an error code is required' using errcode = '22023';
  end if;
  update public.message_outbox set status = 'undeliverable', last_error = p_error
   where club_id = v_club and id = p_message and status = 'pending';
  return found;
end $$;

-- Release handler (ord 60, after F04 10, F05 20, F06 30, F07 35, F08 50): tells the player their hold was released.
-- Not for payment_unavailable (a Beam failure is a screen error in F05) nor offer_ended (the waitlist offer has its
-- own message, F08). One per order: a second release after a reclaim is dropped by the key (accepted, rare).
create function app.f10_released(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_customer uuid;
begin
  if p_reason in ('payment_unavailable', 'offer_ended') then
    return;
  end if;
  select o.customer_id into v_customer from public.orders o where o.club_id = app.club_id() and o.id = p_order;
  perform app.enqueue_message('booking_released', v_customer, jsonb_build_object('order_id', p_order),
                              'released:' || p_order::text, app.now());
end $$;

-- Anonymise handler (migration 0019, PDPA-01-AC5): the person's rows keep the log facts (kind, time, result) and
-- lose their params; a message still waiting can no longer be sent.
create function app.f10_anonymise(p_club uuid, p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  update public.message_outbox
     set params = '{}',
         status = case when status = 'pending' then 'undeliverable' else status end,
         last_error = case when status = 'pending' then 'anonymised' else last_error end
   where club_id = p_club and user_id = p_user;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.cap_state()', 'app.enqueue_message(text, uuid, jsonb, text, timestamptz)',
                           'app.void_messages(text, text)', 'app.void_cap_reminders()', 'app.mark_undeliverable(uuid, text)',
                           'app.f10_released(uuid, text)', 'app.f10_anonymise(uuid, uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
  foreach f in array array['app.cap_state()', 'app.enqueue_message(text, uuid, jsonb, text, timestamptz)',
                           'app.void_messages(text, text)', 'app.void_cap_reminders()', 'app.mark_undeliverable(uuid, text)'] loop
    execute format('grant execute on function %s to booq_worker', f);
  end loop;
end $$;

select app.register_payment_port('enqueue_message', 'app.enqueue_message(text, uuid, jsonb, text, timestamptz)'::regprocedure);
select app.register_release_handler('f10_released', 'app.f10_released(uuid, text)'::regprocedure::regproc, 60);
insert into app.anonymise_handlers (handler_key, handler) values ('f10_outbox', 'app.f10_anonymise(uuid, uuid)'::regprocedure);
