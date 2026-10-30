-- F03-T01 / migration 0201: the orders shell. F03 design 3.1 and 3.2; FA 2.4. Requirements: BOOK-06, CC-1.
-- One order holds one court selection of one or more hours (D40). F04 adds the pricing columns
-- and order_line in its own migration; the shell exists now because a booking needs its order.
-- customer_id is a plain uuid until app_user exists (F01-T12); its composite foreign key is added
-- by the migration that creates app_user (recommended default, D147).
-- Policies for the individual roles and the grants are migration 0206 (F03-T18); until then
-- the tenant policy alone applies and the application roles hold no privilege.

create table public.orders (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  customer_id uuid,                       -- null only for a staff walk-in without a customer record
  source text not null,
  status text not null default 'open',
  is_test boolean not null default false, -- set by trigger from the club status (PLAT-07-AC1)
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),              -- the unique (club_id, id) the composite foreign keys use
  constraint orders_source_values check (source in ('online', 'staff')),
  constraint orders_status_values check (status in ('open', 'paid', 'released', 'cancelled'))
);
create index orders_customer on public.orders (club_id, customer_id, created_at desc);

alter table public.orders owner to booq_owner;
alter table public.orders enable row level security;
alter table public.orders force row level security;
revoke all on public.orders from public;
create policy orders_tenant on public.orders as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());

-- Purge order: children before parents (booking is 200, orders 300; F04 lines go in between).
-- Audit registration (audit.register) is left to the Architect: audit.test.ts pins the F01 list.
select app.register_test_table('public.orders', 300);
