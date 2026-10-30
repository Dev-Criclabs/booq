-- F07-T07 / migration 0807: substituting a coach, and what a rule change leaves unserved (COACH-03, R4-AC1 to AC7, R6-AC1; D120).
-- F07 design 4.1, 5.7, 5.8.
--   coach_substitution (append only)   one row per substitution: the fact F09 reads for "this class had its coach changed".
--   app.coach_flag_reason(club, coach, start)  why a booked hour is no longer offerable by steps 1 to 3 of the coach check:
--                                     'inactive', 'not_working' (no rule, or a closed time) or 'leave' (approved); null when fine.
--   public.coach_flagged_session      future confirmed solo classes whose hour has such a reason. Owner only. Nothing is
--                                     stored, so a flag clears when the rule is fixed or a substitute is set. F08 group
--                                     sessions are listed by F08 (Q-3).
--   app.substitute_coach(booking, new_coach, reason)  owner only. One transaction: both coaches locked in id order, the new
--                                     coach passes coach_check (availability, leave, other bookings, the rest rule; no
--                                     override), the court is kept, the old coach freed and the new one claimed, the price
--                                     untouched. The customer is told coach_changed and both coaches session_change through
--                                     app.coach_message_hook (0805), the no op F10 replaces.
--   app.coach_was_changed(booking)    true when the booking has a substitution (F09 free cancel, CANCEL-01-AC18).

create table public.coach_substitution (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  booking_id uuid not null,
  from_coach_id uuid not null,
  to_coach_id uuid not null,
  by_staff_id uuid not null,
  reason text not null,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, from_coach_id) references public.coach (club_id, id),
  foreign key (club_id, to_coach_id) references public.coach (club_id, id),
  foreign key (club_id, by_staff_id) references public.app_user (club_id, id),
  constraint coach_substitution_reason_values check (reason in ('leave', 'closed_time', 'inactive', 'other')),
  constraint coach_substitution_changes_coach check (from_coach_id <> to_coach_id)
);
create index coach_substitution_by_booking on public.coach_substitution (club_id, booking_id);
create trigger coach_substitution_append_only before update or delete on public.coach_substitution for each row execute function app.refuse_change();
create trigger coach_substitution_no_truncate before truncate on public.coach_substitution for each statement execute function app.refuse_change();

create function app.copy_substitution_is_test() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  new.is_test := coalesce((select b.is_test from public.booking b where b.club_id = new.club_id and b.id = new.booking_id), false);
  return new;
end $$;
alter function app.copy_substitution_is_test() owner to booq_owner;
revoke all on function app.copy_substitution_is_test() from public;
create trigger is_test_copy before insert on public.coach_substitution for each row execute function app.copy_substitution_is_test();

alter table public.coach_substitution owner to booq_owner;
alter table public.coach_substitution enable row level security;
alter table public.coach_substitution force row level security;
revoke all on public.coach_substitution from public;
create policy coach_substitution_tenant on public.coach_substitution as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy coach_substitution_definer on public.coach_substitution for all to booq_owner using (true) with check (true);
select app.register_test_table('public.coach_substitution', 90, false);
select audit.register('public.coach_substitution', array['id']);

create function app.coach_flag_reason(p_club uuid, p_coach uuid, p_start timestamptz) returns text
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_date date := (p_start at time zone 'Asia/Bangkok')::date;
  v_hour integer := extract(hour from p_start at time zone 'Asia/Bangkok')::integer;
  v_dow integer := extract(dow from p_start at time zone 'Asia/Bangkok')::integer;
begin
  if p_club is distinct from app.club_id() then
    return null;                                                     -- only the club of the context
  end if;
  if not exists (select 1 from public.coach c where c.club_id = p_club and c.id = p_coach and c.active) then
    return 'inactive';
  end if;
  if exists (select 1 from public.coach_leave l
              where l.club_id = p_club and l.coach_id = p_coach and l.status = 'approved' and v_date between l.start_date and l.end_date
                and (l.from_hour is null or (v_hour >= l.from_hour and v_hour + 1 <= l.to_hour))) then
    return 'leave';
  end if;
  if not exists (select 1 from public.coach_availability_rule r
                  where r.club_id = p_club and r.coach_id = p_coach and r.kind in ('weekly', 'open')
                    and ((r.kind = 'weekly' and r.weekday = v_dow) or (r.kind = 'open' and r.on_date = v_date))
                    and extract(hour from r.start_time) <= v_hour and v_hour + 1 <= extract(hour from r.end_time))
     or exists (select 1 from public.coach_availability_rule r
                 where r.club_id = p_club and r.coach_id = p_coach and r.kind = 'closed' and r.on_date = v_date
                   and extract(hour from r.start_time) <= v_hour and v_hour + 1 <= extract(hour from r.end_time)) then
    return 'not_working';
  end if;
  return null;
end $$;
alter function app.coach_flag_reason(uuid, uuid, timestamptz) owner to booq_owner;
revoke all on function app.coach_flag_reason(uuid, uuid, timestamptz) from public;
-- A view runs a function with the caller's right to execute it, not the view owner's.
grant execute on function app.coach_flag_reason(uuid, uuid, timestamptz) to booq_app;

create view public.coach_flagged_session with (security_barrier = true) as
select b.id as booking_id, b.coach_id, b.resource_id, b.start_at, b.end_at, f.reason
  from public.booking b
  cross join lateral (select app.coach_flag_reason(b.club_id, b.coach_id, b.start_at) as reason) f
 where b.club_id = app.club_id() and app.has_any_role('owner')
   and b.type = 'solo_class' and b.status = 'confirmed' and b.start_at > app.now()
   and f.reason is not null;
alter view public.coach_flagged_session owner to booq_owner;
revoke all on public.coach_flagged_session from public;
grant select on public.coach_flagged_session to booq_app;

create function app.coach_was_changed(p_booking uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select exists (select 1 from public.coach_substitution s where s.club_id = app.club_id() and s.booking_id = p_booking) $$;
alter function app.coach_was_changed(uuid) owner to booq_owner;
revoke all on function app.coach_was_changed(uuid) from public;
grant execute on function app.coach_was_changed(uuid) to booq_app, booq_worker;

create function app.substitute_coach(p_booking uuid, p_new_coach uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  v_old uuid;
  v_code text;
  v_id uuid;
  c uuid;
begin
  if not app.coach_caller_ok(null, false) then
    raise exception 'coach: not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('leave', 'closed_time', 'inactive', 'other') then
    raise exception 'coach: invalid reason' using errcode = 'P0001';
  end if;
  select coach_id into v_old from public.booking where club_id = v_club and id = p_booking;
  if v_old is null then
    perform app.refuse('booking_not_found');
  end if;
  if v_old = p_new_coach then
    perform app.refuse('coach_unavailable');
  end if;
  -- Both coaches in id order (FA 3.4), then the booking.
  for c in select unnest(case when v_old < p_new_coach then array[v_old, p_new_coach] else array[p_new_coach, v_old] end) loop
    perform app.lock_coach(c);
  end loop;
  select * into b from public.booking where club_id = v_club and id = p_booking for update;
  if b.coach_id is distinct from v_old then
    perform app.refuse('not_movable');                                  -- changed under us
  end if;
  if b.start_at <= app.now() then perform app.refuse('hour_started'); end if;
  if b.status <> 'confirmed' or b.type <> 'solo_class' then perform app.refuse('not_movable'); end if;
  v_code := app.coach_check(v_club, p_new_coach, array[b.start_at], p_booking);
  if v_code is not null then perform app.coach_refuse(v_code); end if;
  begin
    update public.occupancy set coach_id = p_new_coach where club_id = v_club and booking_id = p_booking and coach_id = v_old;
    update public.booking set coach_id = p_new_coach, updated_at = app.now() where club_id = v_club and id = p_booking;
  exception when exclusion_violation then
    perform app.refuse('coach_unavailable');
  end;
  insert into public.coach_substitution (club_id, booking_id, from_coach_id, to_coach_id, by_staff_id, reason)
  values (v_club, p_booking, v_old, p_new_coach, app.user_id(), p_reason) returning id into v_id;
  perform app.coach_message_hook('coach_changed', b.customer_id, jsonb_build_object('booking_id', p_booking, 'coach_id', p_new_coach),
                                 'coach_changed:' || p_booking || ':' || p_new_coach);
  perform app.coach_message_hook('session_change', v_old, jsonb_build_object('booking_id', p_booking), 'session_change:' || p_booking || ':' || p_new_coach || ':' || v_old);
  perform app.coach_message_hook('session_change', p_new_coach, jsonb_build_object('booking_id', p_booking), 'session_change:' || p_booking || ':' || p_new_coach || ':' || p_new_coach);
  return v_id;
end $$;
alter function app.substitute_coach(uuid, uuid, text) owner to booq_owner;
revoke all on function app.substitute_coach(uuid, uuid, text) from public;
grant execute on function app.substitute_coach(uuid, uuid, text) to booq_app;
