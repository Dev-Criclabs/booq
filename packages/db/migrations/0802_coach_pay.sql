-- F07-T02 / migration 0802: coach_pay (COACH-02, R2, CC-3; D156). F07 design 4.1: "this is the table that holds the
-- coach pay fields". Owner only: only the club owner reads or writes it; front desk, the accountant (payouts come
-- through F13's views), the coach (who reads only the amounts F13 computes for them), BOOQ staff and the worker have
-- no access. A null means the owner has not set it and is never replaced by a default. The solo and group pay are
-- applied to the coaching portion only: 'fixed' is satang a session, 'percent' is basis points of the coaching portion.
-- No delete is granted (the row is changed, not removed); the amounts are personal financial data and are kept apart
-- in the audit log.
create table public.coach_pay (
  club_id uuid not null,
  coach_id uuid not null,
  monthly_base_satang integer,                   -- null for a freelancer
  solo_pay_kind text,
  solo_pay_value integer,
  group_pay_kind text,
  group_pay_value integer,
  is_test boolean not null default false,
  primary key (club_id, coach_id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  constraint coach_pay_base check (monthly_base_satang is null or monthly_base_satang >= 0),
  constraint coach_pay_solo_kind check (solo_pay_kind is null or solo_pay_kind in ('fixed', 'percent')),
  constraint coach_pay_group_kind check (group_pay_kind is null or group_pay_kind in ('fixed', 'percent')),
  constraint coach_pay_solo_pair check ((solo_pay_kind is null) = (solo_pay_value is null)),
  constraint coach_pay_group_pair check ((group_pay_kind is null) = (group_pay_value is null)),
  constraint coach_pay_solo_value check (solo_pay_value is null or (solo_pay_value >= 0 and (solo_pay_kind <> 'percent' or solo_pay_value <= 10000))),
  constraint coach_pay_group_value check (group_pay_value is null or (group_pay_value >= 0 and (group_pay_kind <> 'percent' or group_pay_value <= 10000)))
);

alter table public.coach_pay owner to booq_owner;
alter table public.coach_pay enable row level security;
alter table public.coach_pay force row level security;
revoke all on public.coach_pay from public;
create policy coach_pay_tenant on public.coach_pay as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy coach_pay_definer on public.coach_pay for all to booq_owner using (true) with check (true);
create policy coach_pay_owner on public.coach_pay for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
grant select, insert, update on public.coach_pay to booq_app;

create trigger is_test_copy before insert on public.coach_pay for each row execute function app.copy_coach_is_test();
select app.register_test_table('public.coach_pay', 840, false);
select audit.register('public.coach_pay', array['coach_id'], 'club_id',
  array['monthly_base_satang', 'solo_pay_kind', 'solo_pay_value', 'group_pay_kind', 'group_pay_value']);
