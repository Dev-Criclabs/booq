-- F09-T01 / migration 1001: booking_cancel and the booking_state view. F09 design 3.1 and 3.3; decision D158.
-- Requirements: CANCEL-01-AC11, CANCEL-04-AC1 to AC3, AC12, F07 R5-AC5.
--
--   * booking_cancel: one row per cancel, staff mark or reversal; the booking row keeps only its status.
--     Append only like the ledgers (FA 2.3): no role holds UPDATE, DELETE or TRUNCATE, a trigger refuses them
--     for everyone (the Go live purge alone may delete test rows), RLS is forced. Rows are written only by the
--     F09 definer functions (T05 to T08), so no app role may insert. (club_id, booking_id, version) is unique,
--     so a repeated call is a no-op for the caller that re-reads the existing row (CANCEL-01-AC14).
--     reason is the staff reason: required and not blank for every staff kind, null for a player cancel. It is
--     read by front desk and owner only (design 7); a player reads the rows of their own bookings (the outcome),
--     and no player route selects the reason (CC-3). returned holds ids and numbers only.
--     closure_id gets its foreign key with the closure table (F09-T02, migration 1002).
--   * booking_state(club_id, booking_id, state): Played is derived, never stored and never set by a job
--     (D158, A-2): `played` when the booking is confirmed and its slot has ended, otherwise the stored status.
--     SECURITY INVOKER, so each caller sees exactly the bookings their own row policies allow.

create table public.booking_cancel (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  order_id uuid not null,
  kind text not null,
  outcome text not null,
  version integer not null,
  returned jsonb not null default '{}'::jsonb,
  credit_lost boolean not null default false,
  reason text,
  by_user uuid,                           -- null for a job (the closure roll)
  closure_id uuid,
  created_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  constraint booking_cancel_one_per_version unique (club_id, booking_id, version),
  constraint booking_cancel_kind check (kind in ('player_cancel', 'staff_cancel', 'club_cancel', 'closure', 'late_cancel_mark', 'no_show_mark', 'reversal')),
  constraint booking_cancel_outcome check (outcome in ('returned', 'forfeited')),
  constraint booking_cancel_version check (version >= 1),
  constraint booking_cancel_reason check (
    case when kind = 'player_cancel' then reason is null else btrim(coalesce(reason, '')) <> '' end
  )
);
create index booking_cancel_by_order on public.booking_cancel (club_id, order_id);

create trigger booking_cancel_append_only before update or delete on public.booking_cancel
  for each row execute function app.refuse_change();
create trigger booking_cancel_no_truncate before truncate on public.booking_cancel
  for each statement execute function app.refuse_change();

alter table public.booking_cancel owner to booq_owner;
alter table public.booking_cancel enable row level security;
alter table public.booking_cancel force row level security;
revoke all on public.booking_cancel from public;
create policy booking_cancel_tenant on public.booking_cancel as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy booking_cancel_definer on public.booking_cancel for all to booq_owner using (true) with check (true);
create policy booking_cancel_staff_read on public.booking_cancel for select to booq_app
  using (app.has_any_role('owner', 'front_desk'));
create policy booking_cancel_own_read on public.booking_cancel for select to booq_app
  using (app.user_id() is not null and exists (
    select 1 from public.booking b
     where b.club_id = booking_cancel.club_id and b.id = booking_cancel.booking_id and b.customer_id = app.user_id()));
create policy booking_cancel_worker_read on public.booking_cancel for select to booq_worker using (true);
grant select on public.booking_cancel to booq_app, booq_worker;

-- Purged before the bookings (200) it points at.
select app.register_test_table('public.booking_cancel', 190);
select audit.register('public.booking_cancel', array['id']);

create view public.booking_state with (security_invoker = true) as
select b.club_id, b.id as booking_id,
       case when b.status = 'confirmed' and b.end_at <= app.now() then 'played' else b.status end as state
  from public.booking b
 where b.club_id = app.club_id();
alter view public.booking_state owner to booq_owner;
revoke all on public.booking_state from public;
grant select on public.booking_state to booq_app, booq_worker;
