-- F08-T08 / migration 0910: what the schedule shows about classes and what a player sees of their own place in line
-- (CLASS-01-AC5 to AC8, CLASS-02-AC8, AC14, CC-3). F08 design 4.6, 3.2.
--   public.public_class_state  one row per scheduled future session: name, level, audience, the coach's display name, the court's
--       name, min and max players, spots_left, full and waitlist (is anyone waiting). Counts only: no player, no booking, no entry
--       id, no coach or court id. Readable by every role, guests included. It shows a Live or Paused club to everyone, a Testing
--       club only to its testers, a Draft club to nobody (as the views of 0220). The audience filter is added by the route with
--       app.class_visible, so a class hidden from a player is refused by the API and not only hidden (CC-2).
--   public.waitlist_position   the caller's own live entries (waiting or offered) with their position: the number of waiting or
--       offered entries of the same subject with a lower seq, plus one. Never another player's row (CC-3).

create view public.public_class_state with (security_barrier = true) as
select s.id as session_id, s.start_at, s.end_at, s.name_th, s.name_en, s.level, s.audience, u.display_name as coach_name,
       r.name as court_name, s.min_players, s.max_players,
       greatest(s.max_players - t.taken, 0)::integer as spots_left,
       (t.taken >= s.max_players) as full,
       exists (select 1 from public.waitlist_entry w where w.club_id = s.club_id and w.class_session_id = s.id and w.status in ('waiting', 'offered')) as waitlist
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

create view public.waitlist_position with (security_barrier = true) as
select w.id as entry_id, w.subject_kind, w.class_session_id, w.resource_id, w.slot_start_at, w.status, w.offer_expires_at,
       (select count(*) + 1 from public.waitlist_entry o
         where o.club_id = w.club_id and o.status in ('waiting', 'offered') and o.seq < w.seq
           and ((w.class_session_id is not null and o.class_session_id = w.class_session_id)
             or (w.class_session_id is null and o.resource_id = w.resource_id and o.slot_start_at = w.slot_start_at)))::integer as position
  from public.waitlist_entry w
 where w.club_id = app.club_id() and w.customer_id = app.user_id() and w.status in ('waiting', 'offered');

alter view public.public_class_state owner to booq_owner;
alter view public.waitlist_position owner to booq_owner;
revoke all on public.public_class_state, public.waitlist_position from public;
-- Every role of the app, guests included (a guest's context has no user and the role 'guest').
grant select on public.public_class_state to booq_app, booq_worker;
grant select on public.waitlist_position to booq_app;
