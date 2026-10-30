-- F03-T02 / migration 0203: occupancy, the one place the no double booking rule lives.
-- FA 3.1 and F03 design 3.3. Requirements: BOOK-04-AC1, AC2, AC3, AC6, BOOK-01-AC1. SR-07.
--
-- One row per booked hour (a closure may be any range). A row exists only while the claim is live
-- (held or confirmed); releasing or cancelling deletes it, so the constraints never need to know
-- about "expired" or "cancelled". Two exclusion constraints reject an overlap on the court and on
-- the coach, so a solo class (court and coach in one row) is claimed whole or not at all.
--
-- coach_id, class_session_id and closure_id are plain uuid columns until coach (F07), class_session
-- (F08) and closure (F09) exist; the migrations that create them add the composite foreign keys
-- (recommended default, D147). The application roles get no privilege: the only write path is the
-- definer functions of migration 0204 (F03-T06).

create table public.occupancy (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  kind text not null,
  resource_id uuid,
  coach_id uuid,
  start_at timestamptz not null,
  end_at timestamptz not null,
  state text not null,
  hold_expires_at timestamptz,
  booking_id uuid,
  class_session_id uuid,
  closure_id uuid,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, resource_id) references public.resource (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),

  constraint occupancy_kind_values check (kind in ('court_booking', 'solo_class', 'group_class', 'closure')),
  constraint occupancy_state_values check (state in ('held', 'confirmed')),
  constraint occupancy_range check (end_at > start_at),
  constraint occupancy_one_parent check (num_nonnulls(booking_id, class_session_id, closure_id) = 1),
  constraint occupancy_hold_matches_state check ((state = 'held') = (hold_expires_at is not null)),
  constraint occupancy_claims_something check (resource_id is not null or coach_id is not null),
  constraint occupancy_solo_needs_both check (kind <> 'solo_class' or (resource_id is not null and coach_id is not null)),
  constraint occupancy_group_needs_both check (kind <> 'group_class' or (resource_id is not null and coach_id is not null)),
  constraint occupancy_court_has_no_coach check (kind <> 'court_booking' or (resource_id is not null and coach_id is null)),
  constraint occupancy_closure_is_court check (kind <> 'closure' or (resource_id is not null and coach_id is null)),
  -- 60 minutes on the hour in Bangkok for everything but a closure (BOOK-01-AC1, AC2).
  constraint occupancy_one_hour check (kind = 'closure' or end_at - start_at = interval '1 hour'),
  constraint occupancy_on_the_hour check (
    kind = 'closure'
    or date_trunc('hour', start_at at time zone 'Asia/Bangkok') = start_at at time zone 'Asia/Bangkok'
  ),

  constraint occupancy_no_overlap_resource
    exclude using gist (resource_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (resource_id is not null),
  constraint occupancy_no_overlap_coach
    exclude using gist (coach_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (coach_id is not null)
);

create index occupancy_club_time on public.occupancy (club_id, start_at);
create index occupancy_booking on public.occupancy (club_id, booking_id) where booking_id is not null;
-- The release job and the claim function look for expired holds (design 3.2).
create index occupancy_hold_expiry on public.occupancy (hold_expires_at) where state = 'held';

alter table public.occupancy owner to booq_owner;
alter table public.occupancy enable row level security;
alter table public.occupancy force row level security;
revoke all on public.occupancy from public;
create policy occupancy_tenant on public.occupancy as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());

-- Purge order: before booking (200), because occupancy points at it.
select app.register_test_table('public.occupancy', 100);

-- Audit: orders and bookings are audited (FA 8.1); occupancy only through its booking.
select audit.register('public.orders', array['id']);
select audit.register('public.booking', array['id']);
