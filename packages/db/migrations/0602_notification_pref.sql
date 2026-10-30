-- F10-T03 / migration 0602: notification_pref, the two switches on the player Profile (C17).
-- F10 design 4.1 and 5.10. Requirement LINE-05; decision D94 (Booking reminders controls the 24 hour and
-- 2 hour reminders; Promotions controls the birthday discount and referral reward; everything else is
-- always sent). Assumption A-2: reminders default on, promotions off until the person opts in (PDPA).
-- Class D. No row means the defaults. Each person reads and writes only their own row; staff and the
-- owner see nobody's switches. The sender's read (booq_worker) is F10-T07 (0606).

create table public.notification_pref (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  reminders boolean not null default true,
  promotions boolean not null default false,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  constraint notification_pref_one_per_user unique (club_id, user_id)
);

alter table public.notification_pref owner to booq_owner;
alter table public.notification_pref enable row level security;
alter table public.notification_pref force row level security;
revoke all on public.notification_pref from public;
create policy notification_pref_tenant on public.notification_pref as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy notification_pref_definer on public.notification_pref for all to booq_owner using (true) with check (true);
create policy notification_pref_self on public.notification_pref for all to booq_app
  using (user_id = app.user_id()) with check (user_id = app.user_id());
grant select, insert, update on public.notification_pref to booq_app;

-- The flag follows the person (D100): a tester's switches are test data, an owner's never are.
select app.register_test_table('public.notification_pref', 800, false);
create trigger is_test_copy before insert on public.notification_pref for each row execute function app.copy_user_is_test();
-- The Promotions switch is the person's opt in to promotional messages: changes are kept in the audit log.
select audit.register('public.notification_pref', array['id']);
