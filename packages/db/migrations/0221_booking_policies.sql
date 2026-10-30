-- F03-T18 / migration 0221: who may read orders, bookings and occupancy. F03 design 8; FA 4.3.
-- Requirements: CC-1, PLAT-02-AC1, PDPA-01-AC1. (The design calls this file 0206.)
-- Reads only. Every write goes through the definer functions of 0210 onward (SR-07), so no app
-- role gets insert, update or delete. BOOQ staff have no privilege on any of these (class D).
-- Players see their own bookings and orders, a coach the bookings that name them, owner and front
-- desk and accountant the club's. Everyone else reads the schedule through the public views, which
-- carry no identity (migration 0220), so no player policy on occupancy exists on purpose.

create policy orders_staff_read on public.orders for select to booq_app
  using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy orders_own_read on public.orders for select to booq_app
  using (customer_id is not null and customer_id = app.user_id());
create policy booking_staff_read on public.booking for select to booq_app
  using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy booking_own_read on public.booking for select to booq_app
  using (customer_id is not null and customer_id = app.user_id());
create policy booking_coach_read on public.booking for select to booq_app
  using (coach_id is not null and coach_id = app.user_id());
create policy occupancy_staff_read on public.occupancy for select to booq_app
  using (app.has_any_role('owner', 'front_desk', 'accountant'));

-- Jobs (hold release, reminders, reconcile) run in a club's context and read what they act on.
create policy orders_worker_read on public.orders for select to booq_worker using (true);
create policy booking_worker_read on public.booking for select to booq_worker using (true);
create policy occupancy_worker_read on public.occupancy for select to booq_worker using (true);

grant select on public.orders, public.booking, public.occupancy to booq_app, booq_worker;
