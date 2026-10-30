-- F04-T11 request from BE-C / migration 0316 (replaces the birthday_discount() function asked for first): two more
-- values on public.public_booking_config (F03, 0224), with its visibility rule (a Live or Paused club to everyone, a
-- club in Testing to its testers, a Draft club to nobody): cancel_window_hours (R4-AC5, the cancellation line at
-- checkout) and birthday_discount, {kind, value} (R5-AC1). Both are null when the club has not set them (no default).
-- Numbered above 0224, which defines the view (D159).
create or replace view public.public_booking_config with (security_barrier = true) as
select c.id as club_id, c.status,
       (select nullif(s.value #>> '{}', '')::integer
          from public.club_setting s
         where s.club_id = c.id and s.key = 'booking_window_days') as booking_window_days,
       (select nullif(s.value #>> '{}', '')::integer
          from public.club_setting s
         where s.club_id = c.id and s.key = 'cancel_window_hours') as cancel_window_hours,
       (select s.value
          from public.club_setting s
         where s.club_id = c.id and s.key = 'birthday_discount') as birthday_discount
  from public.club c
 where c.id = app.club_id()
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));
