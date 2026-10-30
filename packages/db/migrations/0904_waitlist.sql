-- F08-T04 / migration 0904: waitlist_entry and the sequence behind its order (CLASS-02-AC1, AC8, AC16; WAIT-01-AC1). F08 design 3.2.
-- An entry waits for one subject: a class session, or one court at one hour (a court slot). seq is the position order:
-- strictly increasing per club, taken from app.next_waitlist_seq() (a row per club locked for the update, so two joins in
-- parallel get different numbers and the later one is behind). The position a player sees is derived from seq in the view
-- of 0910, never stored. A player is in one list once while an entry is waiting or offered (partial unique indexes), but may
-- be in many lists (D157), and there is no maximum length (CLASS-02-AC16). An offer is a held booking (design 4.9):
-- offer_booking_id names it. Class D. Policies and grants come with 0911.

create table public.waitlist_seq (
  club_id uuid not null references public.club (id),
  last_value bigint not null default 0,
  primary key (club_id)
);
alter table public.waitlist_seq owner to booq_owner;
alter table public.waitlist_seq enable row level security;
alter table public.waitlist_seq force row level security;
revoke all on public.waitlist_seq from public;
create policy waitlist_seq_tenant on public.waitlist_seq as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy waitlist_seq_definer on public.waitlist_seq for all to booq_owner using (true) with check (true);

create function app.next_waitlist_seq() returns bigint
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_next bigint;
begin
  if v_club is null then
    raise exception 'next_waitlist_seq needs a club in the context' using errcode = 'P0001';
  end if;
  insert into public.waitlist_seq as s (club_id, last_value) values (v_club, 1)
  on conflict (club_id) do update set last_value = s.last_value + 1
  returning s.last_value into v_next;
  return v_next;
end $$;
alter function app.next_waitlist_seq() owner to booq_owner;
revoke all on function app.next_waitlist_seq() from public;

create table public.waitlist_entry (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  subject_kind text not null,
  class_session_id uuid,
  resource_id uuid,
  slot_start_at timestamptz,
  seq bigint not null,
  status text not null default 'waiting',
  offer_no integer not null default 0,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  offer_booking_id uuid,
  ended_reason text,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, customer_id) references public.app_user (club_id, id),
  foreign key (club_id, class_session_id) references public.class_session (club_id, id),
  foreign key (club_id, resource_id) references public.resource (club_id, id),
  foreign key (club_id, offer_booking_id) references public.booking (club_id, id),
  constraint waitlist_entry_seq_unique unique (club_id, seq),
  constraint waitlist_entry_subject_values check (subject_kind in ('class_session', 'court_slot')),
  constraint waitlist_entry_subject_shape check (
    (subject_kind = 'class_session' and class_session_id is not null and resource_id is null and slot_start_at is null)
    or (subject_kind = 'court_slot' and class_session_id is null and resource_id is not null and slot_start_at is not null)),
  constraint waitlist_entry_slot_on_the_hour check (slot_start_at is null or date_trunc('hour', slot_start_at at time zone 'Asia/Bangkok') = slot_start_at at time zone 'Asia/Bangkok'),
  constraint waitlist_entry_status_values check (status in ('waiting', 'offered', 'claimed', 'declined', 'expired', 'ended', 'left')),
  constraint waitlist_entry_offer_no check (offer_no >= 0),
  -- An offer carries its end time and its held booking while it is live.
  constraint waitlist_entry_offer_shape check (status <> 'offered' or (offer_no >= 1 and offered_at is not null and offer_expires_at is not null and offer_booking_id is not null)),
  constraint waitlist_entry_ended_values check (ended_reason in ('session_cancelled', 'closure', 'slot_passed', 'joined_seat', 'left')),
  constraint waitlist_entry_ended_matches check ((status in ('ended', 'left')) = (ended_reason is not null))
);
-- A player is in a list once while the entry waits or holds an offer; after that they may join again.
create unique index waitlist_entry_one_live_session on public.waitlist_entry (club_id, customer_id, class_session_id)
  where status in ('waiting', 'offered') and class_session_id is not null;
create unique index waitlist_entry_one_live_slot on public.waitlist_entry (club_id, customer_id, resource_id, slot_start_at)
  where status in ('waiting', 'offered') and resource_id is not null;
create index waitlist_entry_session_order on public.waitlist_entry (club_id, class_session_id, seq) where status in ('waiting', 'offered');
create index waitlist_entry_slot_order on public.waitlist_entry (club_id, resource_id, slot_start_at, seq) where status in ('waiting', 'offered');
create index waitlist_entry_offer_expiry on public.waitlist_entry (offer_expires_at) where status = 'offered';
create index waitlist_entry_by_customer on public.waitlist_entry (club_id, customer_id, created_at desc);

-- The seat (or the held offer) remembers the entry it came from (0903 added the column).
-- The entry and the booking point at each other; the test data purge deletes entries first (they name an offer's booking), so
-- deleting an entry only clears the booking's pointer.
alter table public.booking add constraint booking_waitlist_entry_fk foreign key (club_id, waitlist_entry_id)
  references public.waitlist_entry (club_id, id) on delete set null (waitlist_entry_id);

alter table public.waitlist_entry owner to booq_owner;
alter table public.waitlist_entry enable row level security;
alter table public.waitlist_entry force row level security;
revoke all on public.waitlist_entry from public;
create policy waitlist_entry_tenant on public.waitlist_entry as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy waitlist_entry_definer on public.waitlist_entry for all to booq_owner using (true) with check (true);

-- Deleted by the test data purge after occupancy and before the bookings it names and the sessions.
select app.register_test_table('public.waitlist_entry', 160);
select audit.register('public.waitlist_entry', array['id']);
