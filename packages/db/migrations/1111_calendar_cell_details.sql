-- F11 / migration 1111: three more things on a staff calendar cell (A1, ADMIN-03; orchestrator note from lane 2), redefining public.staff_calendar
-- of 1101 (D159). class_booked and class_max_players: the live seats (confirmed or awaiting payment) and the cap of a group class session (A-0024).
-- payment_method and payment_state: how the booking is paid, from its order: beam or cash from its latest live payment, else credit or wallet when
-- the order was covered by them; state paid or pending (A-0021, A-0030, A-0032). closure_reason: the reason the staff typed on a closure, shown on
-- its cells (A-0028). Booking source (online or staff) is already a column. There is no phone channel in the data (A-0033 'Staff · phone' has no
-- source value), so none is invented. Names and reasons only; no phone number or date of birth.
drop function public.staff_calendar(date, date);
create function public.staff_calendar(p_from date, p_to date)
  returns table (resource_id uuid, resource_name text, start_at timestamptz, end_at timestamptz, kind text, state text, hold_expires_at timestamptz,
                 booking_id uuid, booking_status text, booking_source text, customer_id uuid, customer_name text, coach_id uuid, coach_name text,
                 class_session_id uuid, class_name_th text, class_name_en text, closure_id uuid,
                 class_booked integer, class_max_players integer, payment_method text, payment_state text, closure_reason text)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'calendar: not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from >= 7 then
    raise exception 'calendar: invalid range' using errcode = 'P0001';
  end if;
  return query
    select o.resource_id, r.name, o.start_at, o.end_at, o.kind, o.state, o.hold_expires_at,
           o.booking_id, b.status, b.source, b.customer_id, cu.display_name, o.coach_id, co.display_name,
           o.class_session_id, cs.name_th, cs.name_en, o.closure_id,
           case when cs.id is null then null else (select count(*)::integer from public.booking sb where sb.club_id = o.club_id and sb.class_session_id = cs.id and sb.status in ('confirmed', 'awaiting_payment')) end,
           cs.max_players::integer,
           pm.method, pm.state, cl.reason
      from public.occupancy o
      join public.resource r on r.club_id = o.club_id and r.id = o.resource_id
      left join public.booking b on b.club_id = o.club_id and b.id = o.booking_id
      left join public.app_user cu on cu.club_id = o.club_id and cu.id = b.customer_id
      left join public.app_user co on co.club_id = o.club_id and co.id = o.coach_id
      left join public.class_session cs on cs.club_id = o.club_id and cs.id = o.class_session_id
      left join public.closure cl on cl.club_id = o.club_id and cl.id = o.closure_id
      left join lateral (
        select case when pay.method is not null then pay.method
                    when od.credit_value_satang > 0 then 'credit'
                    when od.wallet_satang > 0 then 'wallet' end as method,
               case when pay.status = 'succeeded' then 'paid' when pay.status = 'pending' then 'pending' when pay.status is null and (od.credit_value_satang > 0 or od.wallet_satang > 0) then 'paid' end as state
          from public.orders od
          left join lateral (select p.method, p.status from public.payment p where p.club_id = od.club_id and p.order_id = od.id and p.status in ('succeeded', 'pending')
                              order by (p.status = 'succeeded') desc, p.created_at desc limit 1) pay on true
         where od.club_id = o.club_id and od.id = b.order_id) pm on b.id is not null
     where o.club_id = v_club
       and o.start_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')
       and o.end_at > (p_from::timestamp at time zone 'Asia/Bangkok')
       and (o.state = 'confirmed' or o.hold_expires_at > app.now())
     order by o.start_at, r.name, o.resource_id;
end $$;
alter function public.staff_calendar(date, date) owner to booq_owner;
revoke all on function public.staff_calendar(date, date) from public;
grant execute on function public.staff_calendar(date, date) to booq_app;
