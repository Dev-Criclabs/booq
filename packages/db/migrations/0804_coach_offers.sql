-- F07-T04 / migration 0804: what the picker offers (COACH-01, R1-AC1 to AC8, COACH-02-AC1). F07 design 5.2.
--   app.court_hour_open(resource, start, ignore_booking)  one court, one hour: active, inside the opening hours, no
--                                  confirmed or unexpired held occupancy and no closure over it.
--   app.assign_court(coach, starts[], booking)  the court a solo selection gets (R1-AC4, D120, assumption A-4): the
--                                  court of p_booking when it is open for every hour (Add a coach keeps the court the
--                                  booking already has; its own row does not count as busy), else the lowest numbered
--                                  active court open for EVERY hour, so one selection keeps one court. null = no court
--                                  open (the caller answers no_court_open, R1-AC3). Advisory: the exclusion constraint
--                                  is final (BOOK-04).
--   app.coaches_offerable(resource, starts[])  active coaches with coach_check null for every hour and a court for
--                                  them: what is offered can be booked (AC7). Locks nothing.
--   public.public_coach_card       active, published (consent recorded) coaches, public profile fields only (R1-AC6,
--                                  CC-3): never leave, notes, pay, consent or who recorded it.
--   public.public_coach_times(coach, from, to)  per Bangkok hour in the club's opening hours: 'open' with the court
--                                  name it would get, or 'no_court_open'; an hour the coach cannot take is not listed
--                                  and gives no reason. A pending leave still shows the hour (D120).
-- A Paused club shows its coaches (the route answers club_paused, R1-AC8); a Testing club only to its testers, a Draft
-- club to nobody, as the public views of 0220.

-- Lowest numbered court first: numeric names in number order, then the other names.
create function app.court_hour_open(p_resource uuid, p_start timestamptz, p_ignore_booking uuid default null) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.resource r
      join public.opening_hours oh on oh.club_id = r.club_id
       and oh.weekday = extract(isodow from (p_start at time zone 'Asia/Bangkok'))::int
     where r.club_id = app.club_id() and r.id = p_resource and r.active
       and extract(epoch from ((p_start at time zone 'Asia/Bangkok')::time)) >= extract(epoch from oh.open)
       and extract(epoch from ((p_start at time zone 'Asia/Bangkok')::time)) + 3600 <= extract(epoch from oh.close)
       and not exists (
         select 1 from public.occupancy o
          where o.club_id = r.club_id and o.resource_id = r.id
            and o.start_at < p_start + interval '1 hour' and o.end_at > p_start
            and (o.state = 'confirmed' or o.hold_expires_at > app.now())
            and (p_ignore_booking is null or o.booking_id is distinct from p_ignore_booking)))
$$;
alter function app.court_hour_open(uuid, timestamptz, uuid) owner to booq_owner;
revoke all on function app.court_hour_open(uuid, timestamptz, uuid) from public;
grant execute on function app.court_hour_open(uuid, timestamptz, uuid) to booq_app, booq_worker;

create function app.assign_court(p_coach uuid, p_starts timestamptz[], p_booking uuid default null) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_pref uuid;
  v_id uuid;
begin
  if v_club is null then
    raise exception 'assign_court needs a club in the context' using errcode = 'P0001';
  end if;
  if p_starts is null or cardinality(p_starts) = 0 or not exists (select 1 from public.coach c where c.club_id = v_club and c.id = p_coach) then
    return null;
  end if;
  if p_booking is not null then
    select b.resource_id into v_pref from public.booking b where b.club_id = v_club and b.id = p_booking;
    if v_pref is not null and not exists (
         select 1 from unnest(p_starts) s where not app.court_hour_open(v_pref, s, p_booking)) then
      return v_pref;
    end if;
  end if;
  select r.id into v_id
    from public.resource r
   where r.club_id = v_club and r.active
     and not exists (select 1 from unnest(p_starts) s where not app.court_hour_open(r.id, s, p_booking))
   order by case when r.name ~ '^[0-9]{1,9}$' then r.name::integer end nulls last, r.name, r.id
   limit 1;
  return v_id;
end $$;
alter function app.assign_court(uuid, timestamptz[], uuid) owner to booq_owner;
revoke all on function app.assign_court(uuid, timestamptz[], uuid) from public;
grant execute on function app.assign_court(uuid, timestamptz[], uuid) to booq_app, booq_worker;

create function app.coaches_offerable(p_resource uuid, p_starts timestamptz[]) returns setof uuid
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  c record;
begin
  if v_club is null then
    raise exception 'coaches_offerable needs a club in the context' using errcode = 'P0001';
  end if;
  if p_starts is null or cardinality(p_starts) = 0 then
    return;
  end if;
  for c in select co.id from public.coach co where co.club_id = v_club and co.active order by co.id loop
    if app.coach_check(v_club, c.id, p_starts) is not null then
      continue;
    end if;
    if p_resource is null then
      if app.assign_court(c.id, p_starts) is null then continue; end if;
    elsif exists (select 1 from unnest(p_starts) s where not app.court_hour_open(p_resource, s)) then
      continue;
    end if;
    return next c.id;
  end loop;
end $$;
alter function app.coaches_offerable(uuid, timestamptz[]) owner to booq_owner;
revoke all on function app.coaches_offerable(uuid, timestamptz[]) from public;
grant execute on function app.coaches_offerable(uuid, timestamptz[]) to booq_app, booq_worker;

create function app.club_shows_publicly() returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select exists (select 1 from public.club c where c.id = app.club_id()
                  and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester())))
$$;
alter function app.club_shows_publicly() owner to booq_owner;
revoke all on function app.club_shows_publicly() from public;
grant execute on function app.club_shows_publicly() to booq_app, booq_worker;

create view public.public_coach_card with (security_barrier = true) as
select co.id, u.display_name, co.tier_id, t.name_th as tier_name_th, t.name_en as tier_name_en,
       co.bio_th, co.bio_en, co.certifications_th, co.certifications_en, co.specialties_th, co.specialties_en,
       co.ages_levels_th, co.ages_levels_en, co.languages, co.photo_path
  from public.coach co
  join public.app_user u on u.club_id = co.club_id and u.id = co.id
  left join public.coach_tier t on t.club_id = co.club_id and t.id = co.tier_id
 where co.club_id = app.club_id()
   and co.active and co.published
   and app.club_shows_publicly();
alter view public.public_coach_card owner to booq_owner;
revoke all on public.public_coach_card from public;
grant select on public.public_coach_card to booq_app, booq_worker;

create function public.public_coach_times(p_coach uuid, p_from date, p_to date)
  returns table (start_at timestamptz, state text, court_name text)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  h timestamptz;
  v_court uuid;
begin
  if v_club is null or p_from is null or p_to is null or not app.club_shows_publicly()
     or not exists (select 1 from public.coach co where co.club_id = v_club and co.id = p_coach and co.active and co.published) then
    return;
  end if;
  -- Today and the 30 days after it, as the schedule (D42).
  for h in
    select (((v_today + g0.n) + oh.open + (g.n || ' hours')::interval) at time zone 'Asia/Bangkok')
      from generate_series(0, 30) as g0(n)
      join public.opening_hours oh on oh.club_id = v_club and oh.weekday = extract(isodow from (v_today + g0.n))::int
      cross join lateral generate_series(0, (extract(epoch from (oh.close - oh.open)) / 3600)::int - 1) as g(n)
     where v_today + g0.n between p_from and p_to
     order by 1
  loop
    if h < app.now() or app.coach_check(v_club, p_coach, array[h]) is not null then
      continue;
    end if;
    v_court := app.assign_court(p_coach, array[h]);
    start_at := h;
    state := case when v_court is null then 'no_court_open' else 'open' end;
    court_name := (select r.name from public.resource r where r.club_id = v_club and r.id = v_court);
    return next;
  end loop;
end $$;
alter function public.public_coach_times(uuid, date, date) owner to booq_owner;
revoke all on function public.public_coach_times(uuid, date, date) from public;
grant execute on function public.public_coach_times(uuid, date, date) to booq_app, booq_worker;
