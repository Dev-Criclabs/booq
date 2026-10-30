-- F07-T08 / migration 0808: who reads the F07 tables (CC-1, CC-3, PDPA-01; R2-AC6, CC-2). F07 design 10.
-- Every F07 table already has row security, the tenant filter and a definer policy (0801, 0802, 0806, 0807), and the
-- table class, audit and test table registry entries. This adds the read policies and the grants. Nobody writes these
-- tables directly: the definer functions of 0805 to 0809 do, so booq_app gets select only.
--   coach                    owner and front desk read all; a coach reads their own row. The Accountant reads none
--                            (names for reports come from app_user_names, D35); a player and a guest read the
--                            public.public_coach_card view only.
--   coach_availability_rule  owner and front desk read all; a coach reads their own rules.
--   coach_leave              owner reads all (with the type and the note); a coach reads their own. The front desk sees
--                            dates and status only, through public.coach_leave_calendar (no type, no note: personal data).
--   coach_price_override     owner only (the staff and player prices come through F04's price function).
--   booking_coach_add        owner and front desk.
--   coach_substitution       owner and front desk read all; a coach reads the substitutions of their own sessions.
--   coach_pay                owner only (0802).
-- BOOQ platform staff have no grant on any of them (PLAT-02); the blind suite checks it.

create policy coach_staff_read on public.coach for select to booq_app using (app.has_any_role('owner', 'front_desk'));
create policy coach_own_read on public.coach for select to booq_app using (app.has_any_role('coach') and id = app.user_id());

create policy coach_availability_rule_staff_read on public.coach_availability_rule for select to booq_app
  using (app.has_any_role('owner', 'front_desk'));
create policy coach_availability_rule_own_read on public.coach_availability_rule for select to booq_app
  using (app.has_any_role('coach') and coach_id = app.user_id());

create policy coach_leave_owner_read on public.coach_leave for select to booq_app using (app.has_any_role('owner'));
create policy coach_leave_own_read on public.coach_leave for select to booq_app
  using (app.has_any_role('coach') and coach_id = app.user_id());

create policy coach_price_override_owner_read on public.coach_price_override for select to booq_app using (app.has_any_role('owner'));

create policy booking_coach_add_staff_read on public.booking_coach_add for select to booq_app using (app.has_any_role('owner', 'front_desk'));

create policy coach_substitution_staff_read on public.coach_substitution for select to booq_app using (app.has_any_role('owner', 'front_desk'));
create policy coach_substitution_coach_read on public.coach_substitution for select to booq_app
  using (app.has_any_role('coach') and (from_coach_id = app.user_id() or to_coach_id = app.user_id()));

grant select on public.coach, public.coach_availability_rule, public.coach_leave, public.coach_price_override,
                public.booking_coach_add, public.coach_substitution to booq_app;

-- The front desk's view of leave: when a coach is away, not why.
create view public.coach_leave_calendar with (security_barrier = true) as
select l.id, l.coach_id, l.start_date, l.end_date, l.from_hour, l.to_hour, l.status
  from public.coach_leave l
 where l.club_id = app.club_id() and app.has_any_role('owner', 'front_desk');
alter view public.coach_leave_calendar owner to booq_owner;
revoke all on public.coach_leave_calendar from public;
grant select on public.coach_leave_calendar to booq_app;
