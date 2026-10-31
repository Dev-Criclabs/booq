-- F10-T10 / migration 0611: the display facts of a message, read at send time. F10 design 5.4 and 5.6; requirements
-- LINE-04-AC1 to AC4, LINE-05, CC-3; decisions D64, D93, PLAT-07.
--   app.message_facts(message)  for a row the sender holds: the club's name, the recipient's given name, the booked hours
--                               (court, coach, start and end), what the order cost and how it was paid, its receipt
--                               number, an amount, a coach's name, a package's credits and expiry, a status, the club's
--                               waitlist claim time and a reminder's hours, from the ids in params. The outbox stores ids
--                               only; names and amounts are read here and never written back (CC-3).
-- Keys are the camelCase names of packages/line MessageFacts. Only facts a kind's ids lead to are filled; the rest are null.

create function app.message_facts(p_message uuid) returns jsonb
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
    'hoursBefore', (select k.hours_before from app.message_kinds k where k.kind = m.kind));
end $$;
alter function app.message_facts(uuid) owner to booq_owner;
revoke all on function app.message_facts(uuid) from public;
grant execute on function app.message_facts(uuid) to booq_worker;
