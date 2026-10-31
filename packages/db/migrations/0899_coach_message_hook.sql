-- F10 / migration 0899: app.coach_message_hook enqueues. F10 design 5.1 and 5.4; requirements LINE-05, CC-3; decisions
-- D96, D159. F07 created the hook as a no op in 0805 (assumption A-7) and calls it from decide_leave (leave_decision) and the
-- substitution (coach_changed, session_change, 0807, 0810); F08 calls it from cancel_session and edit_session (0907:
-- cancellation_result, waitlist_ended, session_change, class_session_changed). Replacing this one function sends them all.
-- Numbered 0899 under D159: above 0805, the only migration that defines the hook (orchestrator, 30 Oct; an exception in
-- docs/architecture/build-plan.md section 4). The dedupe keys are the callers' own.
--   * the F08 kinds waitlist_ended and class_session_changed join the catalogue (always sent, A; no switch)
--   * app.message_facts (0611) also reads a class session: its hour, court, coach and the class name, from params.session_id
--     or the seat's booking

insert into app.message_kinds (kind, cap_class, switch_key) values
  ('waitlist_ended', 'A', null),
  ('class_session_changed', 'A', null);

create or replace function app.coach_message_hook(p_kind text, p_user uuid, p_params jsonb, p_dedupe_key text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  perform app.enqueue_message(p_kind, p_user, p_params, p_dedupe_key, app.now());
end $$;

create or replace function app.message_facts(p_message uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  m public.message_outbox%rowtype;
  c public.club%rowtype;
  v_order uuid;
  v_booking uuid;
  v_hours jsonb;
  o public.orders%rowtype;
  v_package jsonb;
  v_session uuid;
  v_class jsonb;
begin
  if v_club is null then
    raise exception 'message_facts needs a club in the context' using errcode = '42501';
  end if;
  select * into m from public.message_outbox where club_id = v_club and id = p_message;
  if not found then
    raise exception 'message_facts: not found' using errcode = 'P0001';
  end if;
  select * into c from public.club where id = v_club;
  v_order := nullif(m.params ->> 'order_id', '')::uuid;
  v_booking := nullif(m.params ->> 'booking_id', '')::uuid;

  -- The hours of the order (one card for the whole order, BOOK-06) or of the one booking.
  select coalesce(jsonb_agg(jsonb_build_object(
           'bookingId', b.id, 'startAt', b.start_at, 'endAt', b.end_at, 'type', b.type,
           'court', r.name,
           'coachName', (select coalesce(nullif(btrim(u.display_name), ''), u.full_name) from public.app_user u where u.club_id = b.club_id and u.id = b.coach_id))
           order by b.start_at, b.id), '[]'::jsonb)
    into v_hours
    from public.booking b
    left join public.resource r on r.club_id = b.club_id and r.id = b.resource_id
   where b.club_id = v_club
     and ((v_order is not null and b.order_id = v_order) or (v_order is null and v_booking is not null and b.id = v_booking));
  v_session := coalesce(nullif(m.params ->> 'session_id', '')::uuid,
                        (select b.class_session_id from public.booking b where b.club_id = v_club and b.id = v_booking));
  if v_session is not null then
    select jsonb_build_object('th', s.name_th, 'en', s.name_en) into v_class from public.class_session s where s.club_id = v_club and s.id = v_session;
    -- A message about the session itself (the coach's, or a session with no seat in params): its own hour.
    if jsonb_array_length(v_hours) = 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
               'bookingId', null, 'startAt', s.start_at, 'endAt', s.end_at, 'type', 'class_session', 'court', r.name,
               'coachName', (select coalesce(nullif(btrim(u.display_name), ''), u.full_name) from public.app_user u where u.club_id = s.club_id and u.id = s.coach_id))), '[]'::jsonb)
        into v_hours
        from public.class_session s left join public.resource r on r.club_id = s.club_id and r.id = s.resource_id
       where s.club_id = v_club and s.id = v_session;
    end if;
  end if;
  if v_order is null and v_booking is not null then
    select b.order_id into v_order from public.booking b where b.club_id = v_club and b.id = v_booking;
  end if;
  if v_order is not null then
    select * into o from public.orders where club_id = v_club and id = v_order;
  end if;

  if m.params ? 'package_id' then
    select jsonb_build_object('expiresAt', p.expires_at, 'creditsLeft', coalesce(app.package_credits_left(p.id), 0)) into v_package
      from public.customer_package p where p.club_id = v_club and p.id = (m.params ->> 'package_id')::uuid;
  end if;

  return jsonb_build_object(
    'clubName', jsonb_build_object('th', c.name_th, 'en', c.name_en),
    'firstName', (select nullif(split_part(btrim(coalesce(u.full_name, u.display_name, '')), ' ', 1), '')
                    from public.app_user u where u.club_id = v_club and u.id = m.user_id),
    'hours', v_hours,
    'moneySatang', o.money_satang,
    'walletSatang', o.wallet_satang,
    'creditValueSatang', o.credit_value_satang,
    'paidBy', (select p.method from public.payment p where p.club_id = v_club and p.order_id = o.id and p.status = 'succeeded'
                order by p.confirmed_at desc limit 1),
    'receiptNumber', (select r.number from public.receipt r where r.club_id = v_club and r.order_id = o.id and r.kind = 'sale' and r.status = 'issued'
                       order by r.issued_at limit 1),
    'amountSatang', case when jsonb_typeof(m.params -> 'amount_satang') = 'number' then (m.params ->> 'amount_satang')::integer end,
    'coachName', (select coalesce(nullif(btrim(u.display_name), ''), u.full_name) from public.app_user u
                   where u.club_id = v_club and u.id = nullif(m.params ->> 'coach_id', '')::uuid),
    'package', v_package,
    'status', m.params ->> 'status',
    'claimMinutes', (select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::integer end
                       from public.club_setting s where s.club_id = v_club and s.key = 'waitlist_claim_minutes'),
    'hoursBefore', (select k.hours_before from app.message_kinds k where k.kind = m.kind),
    'className', v_class);
end $$;

