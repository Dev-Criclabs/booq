-- F08-T03 / migration 0903: a seat is a booking of type class_seat that names its session (CLASS-01-AC4, AC17, CLASS-02-AC12).
-- F08 design 3.2. booking.class_session_id (composite key to class_session) and booking.waitlist_entry_id (the waitlist
-- entry the seat came from; its key is added with the table in 0904). A seat has a session and only a seat does. The
-- partial unique index makes the database the last guard of "one live seat per player and session": two takers, a retry
-- and an offer claim cannot give one player two seats. Live means awaiting_payment or confirmed; a released, cancelled or
-- no show seat frees the player to take another. Existing rows are unchanged (both columns are null for them).

alter table public.booking add column class_session_id uuid;
alter table public.booking add column waitlist_entry_id uuid;
alter table public.booking add constraint booking_class_session_fk foreign key (club_id, class_session_id) references public.class_session (club_id, id);
alter table public.booking add constraint booking_seat_has_session check ((type = 'class_seat') = (class_session_id is not null));
create unique index booking_one_live_seat on public.booking (club_id, class_session_id, customer_id)
  where status in ('awaiting_payment', 'confirmed');
create index booking_by_session on public.booking (club_id, class_session_id) where class_session_id is not null;
