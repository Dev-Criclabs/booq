-- F03-T01 / migration 0202: booking, one row per booked hour. F03 design 3.2.
-- Requirements: BOOK-06, BOOK-01-AC1, AC2, CC-1. Decisions D40, D46.
-- coach_id and customer_id are plain uuid columns for now: coach (F07) and app_user (F01-T12)
-- do not exist yet; the migrations that create them add the composite foreign keys (D147).
-- The only write path becomes the definer functions of migration 0204 (SR-07, D124); this
-- migration grants nothing to the application roles.

create table public.booking (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  type text not null,
  resource_id uuid not null,
  coach_id uuid,
  start_at timestamptz not null,
  end_at timestamptz not null,
  customer_id uuid,
  status text not null,
  source text not null,
  created_by uuid not null,
  hold_expires_at timestamptz,            -- set at creation, never changed (D46); null once confirmed
  release_reason text,
  override_reason text,                   -- the written reason when staff exceeded the future-hours limit (D49)
  confirmed_at timestamptz,
  released_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  updated_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  foreign key (club_id, resource_id) references public.resource (club_id, id),
  constraint booking_type_values check (type in ('court', 'solo_class', 'class_seat')),
  constraint booking_status_values check (status in ('awaiting_payment', 'confirmed', 'released', 'cancelled', 'no_show', 'late_cancelled')),
  constraint booking_source_values check (source in ('online', 'staff')),
  constraint booking_release_reason_values check (release_reason in ('expired', 'player', 'closed', 'staff')),
  -- 60 minutes on the hour in Bangkok, for every club (BOOK-01-AC1, AC2).
  constraint booking_one_hour check (end_at - start_at = interval '1 hour'),
  constraint booking_on_the_hour check (date_trunc('hour', start_at at time zone 'Asia/Bangkok') = start_at at time zone 'Asia/Bangkok'),
  -- A hold exists exactly while the booking awaits payment.
  constraint booking_hold_matches_status check ((status = 'awaiting_payment') = (hold_expires_at is not null)),
  constraint booking_release_has_reason check (status <> 'released' or (release_reason is not null and released_at is not null)),
  constraint booking_confirmed_has_time check (status <> 'confirmed' or confirmed_at is not null),
  -- A solo class holds a coach; a court booking holds none; a class seat may carry the class coach.
  constraint booking_coach_matches_type check (
    (type = 'solo_class' and coach_id is not null) or (type = 'court' and coach_id is null) or type = 'class_seat'
  )
);

create index booking_customer on public.booking (club_id, customer_id, start_at desc);
create index booking_start on public.booking (club_id, start_at);
create index booking_order on public.booking (club_id, order_id);
-- The release job (the only index without club_id first, design 3.2).
create index booking_hold_expiry on public.booking (hold_expires_at) where status = 'awaiting_payment';
-- The future-hours count (BOOK-05).
create index booking_live_by_customer on public.booking (club_id, customer_id) where status in ('awaiting_payment', 'confirmed');

alter table public.booking owner to booq_owner;
alter table public.booking enable row level security;
alter table public.booking force row level security;
revoke all on public.booking from public;
create policy booking_tenant on public.booking as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());

select app.register_test_table('public.booking', 200);
