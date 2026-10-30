-- F01-T15: the accountant's way to a person's name (decision D35; F01 design 6.2).
-- The accountant has no select on app_user's other columns (the staff policy admits only owner and
-- front desk), so names on receipts and reports come through this view, which carries the tenant
-- filter itself and only the columns an accountant may see. F02's migration 0101 adds full_name to
-- app_user and replaces this view with `create or replace view`, appending full_name.
create view public.app_user_names with (security_barrier = true) as
select u.club_id, u.id, u.display_name
  from public.app_user u
 where u.club_id = app.club_id()
   and app.has_any_role('owner', 'front_desk', 'accountant');
alter view public.app_user_names owner to booq_owner;
revoke all on public.app_user_names from public;
grant select on public.app_user_names to booq_app;
