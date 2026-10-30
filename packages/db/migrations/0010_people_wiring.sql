-- F01-T12 follow-up: what migration 0003 (people) could not do because it runs before 0004, 0005
-- and 0006: the foreign keys to platform.platform_staff, the test-flag registrations and the audit
-- registrations.
alter table public.club_invite add constraint club_invite_created_by_staff_fk foreign key (created_by_staff) references platform.platform_staff (id);
alter table public.club_tester add constraint club_tester_added_by_staff_fk foreign key (added_by_staff) references platform.platform_staff (id);

-- Test flags (F01-T26): a person is a test row only through a tester invite (set by explicit code,
-- D100); their own rows follow them.
select app.register_test_table('public.app_user_role', 800, false);
select app.register_test_table('public.user_staff_note', 800, false);
select app.register_test_table('public.user_consent', 800, false);
select app.register_test_table('public.club_tester', 800, false);
select app.register_test_table('public.app_user', 900, false);
create trigger is_test_copy before insert on public.app_user_role for each row execute function app.copy_user_is_test();
create trigger is_test_copy before insert on public.user_staff_note for each row execute function app.copy_user_is_test();
create trigger is_test_copy before insert on public.user_consent for each row execute function app.copy_user_is_test();
create trigger is_test_copy before insert on public.club_tester for each row execute function app.copy_user_is_test();

-- Audit (F01-T10): personal values go to the pii columns. F02's profile columns are listed now so
-- that its migration does not have to touch the registry.
select audit.register('public.app_user', array['id'], 'club_id',
  array['line_user_id', 'display_name', 'full_name', 'phone', 'phone_normalized', 'date_of_birth']);
select audit.register('public.app_user_role', array['user_id', 'role']);
select audit.register('public.user_staff_note', array['id'], 'club_id', array['note']);
select audit.register('public.club_invite', array['id'], 'club_id', array['bound_line_user_id'], array['token_hash']);
select audit.register('public.club_tester', array['id']);
