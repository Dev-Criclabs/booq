-- F03-T17 / migration 0220: the public views behind the schedule (C4). F03 design 3.3 and 4.6.
-- Requirements: BOOK-01-AC6, AC7, AC14, BOOK-03-AC4, AC6, CC-3. (The design calls this file 0205;
-- numbers below 0219 were taken by the time it was written.)
--
-- A guest, a player, a coach and staff all read these and nothing else about other people's
-- bookings. They carry the tenant filter and the club-visibility rule themselves: a Live or Paused
-- club shows to everyone, a club in Testing only to its testers (app.is_club_tester), a Draft club
-- to nobody. They expose no booking id, customer, coach or order. A hold that has run out is not
-- shown as held (BOOK-03-AC6), whether or not the release job has run.

-- One row per court per hour that is not free. A closure may be any range: each Bangkok hour it
-- touches is closed.
create view public.public_slot_state with (security_barrier = true) as
select o.club_id, o.resource_id, o.start_at,
       (case when o.state = 'held' then 'held' else 'taken' end)::text as state
  from public.occupancy o
  join public.club c on c.id = o.club_id
 where o.club_id = app.club_id()
   and o.resource_id is not null
   and o.kind <> 'closure'
   and (o.state = 'confirmed' or o.hold_expires_at > app.now())
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()))
union all
select o.club_id, o.resource_id, (h.local_hour at time zone 'Asia/Bangkok') as start_at, 'closed'::text as state
  from public.occupancy o
  join public.club c on c.id = o.club_id
  cross join lateral generate_series(
         date_trunc('hour', o.start_at at time zone 'Asia/Bangkok'),
         date_trunc('hour', (o.end_at - interval '1 microsecond') at time zone 'Asia/Bangkok'),
         interval '1 hour') as h(local_hour)
 where o.club_id = app.club_id()
   and o.resource_id is not null
   and o.kind = 'closure'
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));

-- Free hours per court per Bangkok day, for the date strip and the "Day full" state (BOOK-01-AC14):
-- today and the 30 days after it (day 30 is bookable, D42). Hours come from the club's opening
-- hours for that weekday (ISO 1 to 7; a close of 24:00 counts to midnight); an inactive court has
-- none. Hours already past today are not subtracted here; the schedule route does that.
create view public.public_day_state with (security_barrier = true) as
select r.club_id, r.id as resource_id, d.day::date as day,
       greatest(
         extract(epoch from (oh.close - oh.open))::int / 3600
         - (select count(*) from public.public_slot_state s
             where s.club_id = r.club_id and s.resource_id = r.id
               and (s.start_at at time zone 'Asia/Bangkok')::date = d.day::date
               and (s.start_at at time zone 'Asia/Bangkok')::time >= oh.open
               and (s.start_at at time zone 'Asia/Bangkok')::time < oh.close),
         0)::int as open_hours
  from public.resource r
  join public.club c on c.id = r.club_id
  cross join lateral generate_series(
         (app.now() at time zone 'Asia/Bangkok')::date,
         (app.now() at time zone 'Asia/Bangkok')::date + 30,
         interval '1 day') as d(day)
  join public.opening_hours oh on oh.club_id = r.club_id and oh.weekday = extract(isodow from d.day)::int
 where r.club_id = app.club_id()
   and r.active
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));

alter view public.public_slot_state owner to booq_owner;
alter view public.public_day_state owner to booq_owner;
revoke all on public.public_slot_state, public.public_day_state from public;
-- Every role of the app, guests included (a guest's context has no user and the role 'guest').
grant select on public.public_slot_state, public.public_day_state to booq_app, booq_worker;
