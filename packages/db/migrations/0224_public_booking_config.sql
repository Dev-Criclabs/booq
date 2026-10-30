-- F03-T20 / migration 0224: the booking window a guest may read, for the C4 date strip (GET /courts).
-- Requirements: BOOK-01-AC4, AC6, BOOK-02-AC1, AC2. A guest has no read on club_setting (only owner, front
-- desk and accountant do, migration 0002), so the one value the schedule needs is exposed here and nothing
-- else. Same visibility as the schedule views of 0220: a Live or Paused club to everyone, a club in Testing to
-- its testers, a Draft club to nobody. Null when the setting is unset (no default, CLAUDE.md).
create view public.public_booking_config with (security_barrier = true) as
select c.id as club_id, c.status,
       (select nullif(s.value #>> '{}', '')::integer
          from public.club_setting s
         where s.club_id = c.id and s.key = 'booking_window_days') as booking_window_days
  from public.club c
 where c.id = app.club_id()
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));

alter view public.public_booking_config owner to booq_owner;
revoke all on public.public_booking_config from public;
grant select on public.public_booking_config to booq_app, booq_worker;
