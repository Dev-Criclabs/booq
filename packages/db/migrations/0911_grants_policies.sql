-- F08-T09 / migration 0911: who reads and writes the F08 tables (CC-1, CC-3; PLAT-02). F08 design 8.
-- Every F08 table already has row security, the tenant policy and a definer policy (0901, 0902, 0904), and its class, audit and test
-- table entries. This adds the read policies, the owner's write on templates, and the roster view. Sessions, entries and seats are
-- written only by the definer functions (0905 to 0909), so booq_app gets select only on them.
--   class_template   owner and front desk read; the template's own coach reads; the owner inserts and updates (create, edit, end).
--                    There is no delete. The Accountant and players read none.
--   class_session    owner and front desk read; a coach reads the sessions they teach. Players and guests read public.public_class_state.
--   waitlist_entry   owner and front desk read the club's (with names, through app_user); a player reads their own rows only.
--                    The Accountant and coaches read none.
--   waitlist_seq     no grant: only app.next_waitlist_seq writes it.
--   public.class_roster  the live seats of a session with the player's display name: owner and front desk for every session, a coach
--                    for the sessions they teach. No date of birth, no phone, no contact. The Accountant sees names through
--                    app_user_names (D35) and reads no roster.
-- BOOQ platform staff have no grant on any of them (PLAT-02); the blind suite checks it.

create policy class_template_staff_read on public.class_template for select to booq_app using (app.has_any_role('owner', 'front_desk'));
create policy class_template_coach_read on public.class_template for select to booq_app using (app.has_any_role('coach') and coach_id = app.user_id());
create policy class_template_owner_insert on public.class_template for insert to booq_app with check (app.has_any_role('owner'));
create policy class_template_owner_update on public.class_template for update to booq_app using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
grant select, insert, update on public.class_template to booq_app;

create policy class_session_staff_read on public.class_session for select to booq_app using (app.has_any_role('owner', 'front_desk'));
create policy class_session_coach_read on public.class_session for select to booq_app using (app.has_any_role('coach') and coach_id = app.user_id());
grant select on public.class_session to booq_app;

create policy waitlist_entry_staff_read on public.waitlist_entry for select to booq_app using (app.has_any_role('owner', 'front_desk'));
create policy waitlist_entry_own_read on public.waitlist_entry for select to booq_app using (customer_id = app.user_id());
grant select on public.waitlist_entry to booq_app;

create view public.class_roster with (security_barrier = true) as
select b.class_session_id as session_id, b.id as booking_id, b.customer_id, u.display_name, b.status, b.hold_expires_at
  from public.booking b
  join public.app_user u on u.club_id = b.club_id and u.id = b.customer_id
 where b.club_id = app.club_id() and b.class_session_id is not null and b.status in ('awaiting_payment', 'confirmed')
   and (app.has_any_role('owner', 'front_desk')
        or (app.has_any_role('coach') and exists (select 1 from public.class_session s where s.club_id = b.club_id and s.id = b.class_session_id and s.coach_id = app.user_id())));
alter view public.class_roster owner to booq_owner;
revoke all on public.class_roster from public;
grant select on public.class_roster to booq_app;
