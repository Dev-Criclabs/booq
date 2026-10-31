-- F12-T01 / migration 1201: coach_attendance and coach_note. F12 design 3.1 and 3.2. Requirements: CPORT-05, PLAT-04, CC-1, CC-3; D118, D171.
-- Class D (BOOQ staff never).
--   * coach_attendance: one row per booking the coach marked, `present` or `absent`. A hint for staff (D118): it never changes the
--     booking, a forfeit or pay. Written only by the functions of 1204 (the owner role); changed in place, never deleted.
--   * coach_note: the coach's private note on a session (customer null) or on one player, on a solo class (booking_id) or a group
--     session (class_session_id). 2000 characters at most (a technical bound, not a club setting). One note per coach, session and
--     player; the text is personal data about the player, so it is a pii column of the audit log (old and new text kept apart).
--     A blank note is deleted by the function that saves it; the anonymise handler (1207) deletes the notes about an anonymised player.
-- The coach has no grant on either table: the coach reads and writes through definer functions only. Owner and front desk read them
-- (the A2 hint; notes are "staff and coach only"). The accountant, players and the worker read nothing.

create table public.coach_attendance (
  club_id uuid not null,
  booking_id uuid not null,
  coach_id uuid not null,
  mark text not null,
  marked_at timestamptz not null default app.now(),
  changed_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, booking_id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  constraint coach_attendance_mark_values check (mark in ('present', 'absent'))
);

create table public.coach_note (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  coach_id uuid not null,
  booking_id uuid,
  class_session_id uuid,
  customer_id uuid,
  body text not null,
  created_at timestamptz not null default app.now(),
  updated_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, coach_id) references public.coach (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, class_session_id) references public.class_session (club_id, id),
  foreign key (club_id, customer_id) references public.app_user (club_id, id),
  constraint coach_note_one_session check ((booking_id is null) <> (class_session_id is null)),
  constraint coach_note_body check (btrim(body) <> '' and char_length(body) <= 2000)
);
-- One note per coach, session and player (a null player is the session note).
create unique index coach_note_one on public.coach_note
  (club_id, coach_id, coalesce(booking_id, '00000000-0000-0000-0000-000000000000'), coalesce(class_session_id, '00000000-0000-0000-0000-000000000000'),
   coalesce(customer_id, '00000000-0000-0000-0000-000000000000'));
create index coach_note_by_customer on public.coach_note (club_id, coach_id, customer_id) where customer_id is not null;

create trigger is_test_copy before insert on public.coach_attendance for each row execute function app.copy_coach_is_test();
create trigger is_test_copy before insert on public.coach_note for each row execute function app.copy_coach_is_test();

-- Only the functions (the owner role) change a row; an attendance row is never deleted; a note is deleted only by them.
create function app.coach_attendance_guard() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if current_user = 'booq_owner' and new.club_id = old.club_id and new.booking_id = old.booking_id and new.coach_id = old.coach_id then
    return new;
  end if;
  raise exception 'an attendance mark changes only through its function' using errcode = 'P0001';
end $$;
alter function app.coach_attendance_guard() owner to booq_owner;
revoke all on function app.coach_attendance_guard() from public;
create trigger coach_attendance_no_edit before update on public.coach_attendance for each row execute function app.coach_attendance_guard();
create trigger coach_attendance_no_delete before delete on public.coach_attendance for each row execute function app.refuse_change();
create trigger coach_attendance_no_truncate before truncate on public.coach_attendance for each statement execute function app.refuse_change();

create function app.coach_note_guard() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if current_user = 'booq_owner' and (tg_op = 'DELETE' or (new.club_id = old.club_id and new.id = old.id and new.coach_id = old.coach_id
       and new.booking_id is not distinct from old.booking_id and new.class_session_id is not distinct from old.class_session_id
       and new.customer_id is not distinct from old.customer_id)) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'a coach note changes only through its function' using errcode = 'P0001';
end $$;
alter function app.coach_note_guard() owner to booq_owner;
revoke all on function app.coach_note_guard() from public;
create trigger coach_note_no_edit before update or delete on public.coach_note for each row execute function app.coach_note_guard();
create trigger coach_note_no_truncate before truncate on public.coach_note for each statement execute function app.refuse_change();

do $$
declare t text;
begin
  foreach t in array array['coach_attendance', 'coach_note'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format('create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker using (club_id = app.club_id()) with check (club_id = app.club_id())', t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
    execute format('create policy %1$s_staff_read on public.%1$I for select to booq_app using (app.has_any_role(''owner'', ''front_desk''))', t);
  end loop;
end $$;
grant select on public.coach_attendance, public.coach_note to booq_app;

-- Test rows go at Go live, before the booking (200), the session (220) and the coach (850) they point at.
select app.register_test_table('public.coach_note', 70, false);
select app.register_test_table('public.coach_attendance', 71, false);

select audit.register('public.coach_attendance', array['booking_id']);
select audit.register('public.coach_note', array['id'], 'club_id', array['body']);
