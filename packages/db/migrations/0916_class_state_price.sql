-- F08-T12 / migration 0916: public_class_state shows the drop in price (CLASS-01-AC5 to AC8, AC14; D157). F08 design 4.6.
-- C7 and C8 show what a drop in price costs, or nothing when the owner set none (null means credit or wallet only, D157). The column is
-- appended (create or replace view keeps the view's owner and grants). Nothing else in the view changes.
create or replace view public.public_class_state with (security_barrier = true) as
select s.id as session_id, s.start_at, s.end_at, s.name_th, s.name_en, s.level, s.audience, u.display_name as coach_name,
       r.name as court_name, s.min_players, s.max_players,
       greatest(s.max_players - t.taken, 0)::integer as spots_left,
       (t.taken >= s.max_players) as full,
       exists (select 1 from public.waitlist_entry w where w.club_id = s.club_id and w.class_session_id = s.id and w.status in ('waiting', 'offered')) as waitlist,
       s.drop_in_price_satang
  from public.class_session s
  join public.club c on c.id = s.club_id
  join public.resource r on r.club_id = s.club_id and r.id = s.resource_id
  join public.app_user u on u.club_id = s.club_id and u.id = s.coach_id
  cross join lateral (select count(*) as taken from public.booking b
                       where b.club_id = s.club_id and b.class_session_id = s.id
                         and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now()))) t
 where s.club_id = app.club_id()
   and s.status = 'scheduled' and s.start_at > app.now()
   and (c.status in ('live', 'paused') or (c.status = 'testing' and app.is_club_tester()));
