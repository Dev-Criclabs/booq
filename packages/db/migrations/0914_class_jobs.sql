-- F08-T10 / migration 0914: what the class jobs need from the database (CLASS-01-AC2, AC16; CLASS-02-AC4, AC15; WAIT-01-AC4). F08 design 4.2, 4.8, 6.
--   app.generate_sessions_window()  the daily job and the template save: sessions for today to today + booking_window_days in the club's
--       context, and how many sessions need attention. With no booking_window_days nothing is made (skipped). Owner, front desk, worker.
--   app.end_passed_waitlist_entries()  worker only, across clubs: a waiting or offered entry whose class has started, or whose court
--       hour has started, is over (ended, slot_passed). An offered one also loses its offer message. The offer's held booking ends
--       on its own hold, which is never later than the start.
--   app.due_below_minimum(limit)  worker only, across clubs: scheduled sessions below their minimum, inside the alert time before the
--       start (the club's below_min_alert_minutes; empty or 0 means no alert at all, CLASS-01-AC16), not yet alerted. A rerun finds
--       nothing the alert already covers.
--   app.send_below_minimum_alert(session)  in the club's context: one class_below_minimum message to every active front desk person,
--       key below_min:{session}:{user}, sent at the alert time. The alert only informs; nothing cancels a session on its own.
--   The booking trigger of 0908 voided the alert by its exact key; the keys now carry the recipient, so it voids by prefix
--       (rule D159: seat_live_effects is redefined here).

create function app.generate_sessions_window() returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_window text := app.club_setting_text('booking_window_days');
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_made integer := 0;
  v_attention integer;
begin
  if v_club is null then
    raise exception 'generate_sessions_window needs a club in the context' using errcode = '42501';
  end if;
  if v_window ~ '^[0-9]+$' then
    v_made := app.generate_sessions(v_today, v_today + v_window::int);
  end if;
  select count(*)::integer into v_attention from public.class_session s where s.club_id = v_club and s.status = 'needs_attention' and s.start_at > app.now();
  return jsonb_build_object('made', v_made, 'needs_attention', v_attention, 'skipped', v_window is null or v_window !~ '^[0-9]+$');
end $$;
alter function app.generate_sessions_window() owner to booq_owner;
revoke all on function app.generate_sessions_window() from public;
grant execute on function app.generate_sessions_window() to booq_app, booq_worker;

create function app.end_passed_waitlist_entries() returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.message_outbox m set status = 'void', void_reason = 'cancelled'
   where m.status = 'pending' and m.kind = 'waitlist_offer'
     and exists (select 1 from public.waitlist_entry w
                  where w.club_id = m.club_id and w.status = 'offered' and m.dedupe_key like 'offer:' || w.id::text || ':%'
                    and coalesce((select s.start_at from public.class_session s where s.club_id = w.club_id and s.id = w.class_session_id), w.slot_start_at) <= app.now());
  update public.waitlist_entry w set status = 'ended', ended_reason = 'slot_passed'
   where w.status in ('waiting', 'offered')
     and coalesce((select s.start_at from public.class_session s where s.club_id = w.club_id and s.id = w.class_session_id), w.slot_start_at) <= app.now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
alter function app.end_passed_waitlist_entries() owner to booq_owner;
revoke all on function app.end_passed_waitlist_entries() from public;
grant execute on function app.end_passed_waitlist_entries() to booq_worker;

create function app.due_below_minimum(p_limit integer default 200) returns table (club_id uuid, session_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select s.club_id, s.id
      from public.class_session s
      join public.club c on c.id = s.club_id and c.status in ('live', 'paused')
      join public.club_setting cs on cs.club_id = s.club_id and cs.key = 'below_min_alert_minutes'
     where s.status = 'scheduled' and s.start_at > app.now()
       and jsonb_typeof(cs.value) = 'number' and (cs.value #>> '{}')::numeric > 0
       and app.now() >= s.start_at - ((cs.value #>> '{}')::numeric * interval '1 minute')
       and (select count(*) from public.booking b where b.club_id = s.club_id and b.class_session_id = s.id
             and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now()))) < s.min_players
       and not exists (select 1 from public.message_outbox m where m.club_id = s.club_id and left(m.dedupe_key, length('below_min:' || s.id::text || ':')) = 'below_min:' || s.id::text || ':')
     order by s.start_at, s.id
     limit greatest(1, p_limit);
end $$;
alter function app.due_below_minimum(integer) owner to booq_owner;
revoke all on function app.due_below_minimum(integer) from public;
grant execute on function app.due_below_minimum(integer) to booq_worker;

create function app.send_below_minimum_alert(p_session uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s public.class_session%rowtype;
  u record;
  v_n integer := 0;
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from public.class_session where club_id = v_club and id = p_session and status = 'scheduled' and start_at > app.now();
  if not found then return 0; end if;
  for u in select r.user_id from public.app_user_role r join public.app_user a on a.club_id = r.club_id and a.id = r.user_id
            where r.club_id = v_club and r.role = 'front_desk' and a.active order by r.user_id loop
    if app.enqueue_message('class_below_minimum', u.user_id, jsonb_build_object('session_id', p_session, 'taken', app.session_taken(p_session), 'min_players', s.min_players),
                           'below_min:' || p_session || ':' || u.user_id, app.now()) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
alter function app.send_below_minimum_alert(uuid) owner to booq_owner;
revoke all on function app.send_below_minimum_alert(uuid) from public;
grant execute on function app.send_below_minimum_alert(uuid) to booq_worker;

create or replace function app.seat_live_effects() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  s public.class_session%rowtype;
begin
  if new.class_session_id is not null and new.status in ('awaiting_payment', 'confirmed') then
    update public.waitlist_entry set status = 'ended', ended_reason = 'joined_seat'
     where club_id = new.club_id and class_session_id = new.class_session_id and customer_id = new.customer_id and status = 'waiting'
       and id is distinct from new.waitlist_entry_id;
    select * into s from public.class_session where club_id = new.club_id and id = new.class_session_id;
    if found and (select count(*) from public.booking b where b.club_id = new.club_id and b.class_session_id = new.class_session_id
                    and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now()))) >= s.min_players then
      update public.message_outbox set status = 'void', void_reason = 'superseded'
       where club_id = new.club_id and status = 'pending'
         and left(dedupe_key, length('below_min:' || new.class_session_id::text || ':')) = 'below_min:' || new.class_session_id::text || ':';
    end if;
  end if;
  if new.waitlist_entry_id is not null and new.status = 'confirmed' then
    update public.waitlist_entry set status = 'claimed' where club_id = new.club_id and id = new.waitlist_entry_id and status = 'offered';
    update public.message_outbox set status = 'void', void_reason = 'cancelled'
     where club_id = new.club_id and status = 'pending' and left(dedupe_key, length('offer:' || new.waitlist_entry_id::text || ':')) = 'offer:' || new.waitlist_entry_id::text || ':';
  end if;
  return null;
end $$;
