-- F11-T03 / migration 1101: the staff calendar read (ADMIN-03; F11 design 6.1). public.staff_calendar(from, to) returns every occupancy
-- row of the club that overlaps the Bangkok days from..to (inclusive, at most 7 days) with what A1 draws in a cell: the court, the kind
-- (court booking, solo class, group class, closure), the state (confirmed, or held with its expiry; an expired hold is not a cell), the
-- booking and its status and source, the customer's and the coach's display names, and the class name. Names only: no phone, no date of
-- birth, no note. Owner and front desk only (calendar.read); anyone else, and a call with no club, is refused. It writes nothing.
create function public.staff_calendar(p_from date, p_to date)
  returns table (resource_id uuid, resource_name text, start_at timestamptz, end_at timestamptz, kind text, state text, hold_expires_at timestamptz,
                 booking_id uuid, booking_status text, booking_source text, customer_id uuid, customer_name text, coach_id uuid, coach_name text,
                 class_session_id uuid, class_name_th text, class_name_en text, closure_id uuid)
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
           o.class_session_id, cs.name_th, cs.name_en, o.closure_id
      from public.occupancy o
      join public.resource r on r.club_id = o.club_id and r.id = o.resource_id
      left join public.booking b on b.club_id = o.club_id and b.id = o.booking_id
      left join public.app_user cu on cu.club_id = o.club_id and cu.id = b.customer_id
      left join public.app_user co on co.club_id = o.club_id and co.id = o.coach_id
      left join public.class_session cs on cs.club_id = o.club_id and cs.id = o.class_session_id
     where o.club_id = v_club
       and o.start_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')
       and o.end_at > (p_from::timestamp at time zone 'Asia/Bangkok')
       and (o.state = 'confirmed' or o.hold_expires_at > app.now())
     order by o.start_at, r.name, o.resource_id;
end $$;
alter function public.staff_calendar(date, date) owner to booq_owner;
revoke all on function public.staff_calendar(date, date) from public;
grant execute on function public.staff_calendar(date, date) to booq_app;
