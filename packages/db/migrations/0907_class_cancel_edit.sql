-- F08-T05c / migration 0907: cancelling and editing a session (CLASS-01-AC10, AC11, AC13; CLASS-02-AC11). F08 design 4.2, 4.7.
--   app.cancel_session(session, reason)  owner and front desk. In one transaction: the session is cancelled (reason below_minimum,
--       owner, template or coach), its occupancy row is deleted (court and coach are free, CLASS-01-AC13), every live seat is
--       cancelled and its value returned through F09's app.return_booking_value(booking, 'club_cancel') (a held seat is released
--       through release_hold instead, so its credit and wallet reservation go back by the release handlers), the session's waitlist
--       entries are ended (session_cancelled), and the seat holders, the entries and the coach are told through
--       app.coach_message_hook (the no op F10 replaces: cancellation_result, waitlist_ended, session_change). Value never goes back as
--       cash: F09 returns credit to the package or money to the wallet. A past session is never changed. The call fails closed while
--       app.return_booking_value does not exist (F09-T05, migration 1005) and the session has a paid seat.
--   app.edit_session(session, changes)  owner. Changes any of name_th, name_en, level, coach_id, resource_id, start_at, min_players,
--       max_players, drop_in_price_satang of a scheduled future session; the session is marked edited, a change of hour, court or
--       coach moves its occupancy row under the same checks (a clash is refused with its code), the live seats follow the new
--       hour and court, and every seat holder is told (session_changed). max_players cannot go below the seats taken (below_taken).
--   app.apply_template_edit(template)  owner. After a template change: every future session of the template that is not edited and
--       has no live seat is brought to the template (name, level, players, drop in price, coach, court); one whose date no longer
--       matches the template's weekday and hour is cancelled (reason template) and the sessions of the new weekday are generated.
--       A session with players keeps its details (D121); it is changed only by edit_session.
-- All three take the locks of FA 3.4: coach rows (id order), the session row, its bookings (id order), then the court lock
-- app.lock_resource immediately before an occupancy write.

create function app.return_seat_value(p_booking uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_fn regproc := to_regprocedure('app.return_booking_value(uuid, text)')::regproc;
begin
  if v_fn is null then
    raise exception 'cancel: the value return is not installed' using errcode = 'P0001';
  end if;
  execute format('select %s($1, $2)', v_fn) using p_booking, 'club_cancel';
end $$;
alter function app.return_seat_value(uuid) owner to booq_owner;
revoke all on function app.return_seat_value(uuid) from public;

create function app.cancel_session(p_session uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s public.class_session%rowtype;
  b record;
  e record;
  v_seats integer := 0;
  v_entries integer := 0;
  v_coach uuid;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'session: not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('below_minimum', 'owner', 'template', 'coach') then
    raise exception 'session: invalid reason' using errcode = 'P0001';
  end if;
  select coach_id into v_coach from public.class_session where club_id = v_club and id = p_session;
  if v_coach is null then perform app.refuse('session_not_available'); end if;
  perform app.lock_coach(v_coach);
  select * into s from public.class_session where club_id = v_club and id = p_session for update;
  if s.status = 'cancelled' then return jsonb_build_object('seats', 0, 'entries', 0, 'repeated', true); end if;
  if s.start_at <= app.now() then perform app.refuse('hour_started'); end if;

  -- The session is cancelled first, so the release handlers that run below (the waitlist advance among them) see a cancelled session.
  update public.class_session set status = 'cancelled', attention_reason = null, cancel_reason = p_reason, cancelled_by = app.user_id(), cancelled_at = app.now()
   where club_id = v_club and id = p_session;
  -- The waiting list ends with the session.
  for e in select id, customer_id from public.waitlist_entry
            where club_id = v_club and class_session_id = p_session and status in ('waiting', 'offered') order by id for update loop
    update public.waitlist_entry set status = 'ended', ended_reason = 'session_cancelled' where club_id = v_club and id = e.id;
    v_entries := v_entries + 1;
    perform app.coach_message_hook('waitlist_ended', e.customer_id, jsonb_build_object('entry_id', e.id, 'session_id', p_session), 'waitlist_ended:' || e.id);
  end loop;
  -- The live seats, in id order; a paid seat gets its value back, a held seat (an open offer is one) is released.
  for b in select id, order_id, status, customer_id from public.booking
            where club_id = v_club and class_session_id = p_session and status in ('awaiting_payment', 'confirmed') order by id for update loop
    if b.status = 'confirmed' then
      update public.booking set status = 'cancelled', updated_at = app.now() where club_id = v_club and id = b.id;
      perform app.return_seat_value(b.id);
    else
      perform app.release_hold(b.order_id, 'staff');
    end if;
    v_seats := v_seats + 1;
    perform app.coach_message_hook('cancellation_result', b.customer_id, jsonb_build_object('booking_id', b.id), 'cancellation_result:' || b.id);
  end loop;
  if s.status = 'scheduled' then
    perform app.lock_resource(s.resource_id);                  -- step 3c, last before the occupancy write
    delete from public.occupancy where club_id = v_club and class_session_id = p_session;
  end if;
  perform app.coach_message_hook('session_change', s.coach_id, jsonb_build_object('session_id', p_session), 'session_change:' || p_session || ':cancelled');
  return jsonb_build_object('seats', v_seats, 'entries', v_entries);
end $$;

create function app.edit_session(p_session uuid, p_changes jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  s public.class_session%rowtype;
  n public.class_session%rowtype;
  c jsonb := coalesce(p_changes, '{}'::jsonb);
  k text;
  v_taken integer;
  v_problem text;
  v_moved boolean;
  v_lock uuid;
  b record;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner') then
    raise exception 'session: not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(c) <> 'object' or c = '{}'::jsonb then
    raise exception 'session: invalid changes' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(c) loop
    if k not in ('name_th', 'name_en', 'level', 'coach_id', 'resource_id', 'start_at', 'min_players', 'max_players', 'drop_in_price_satang') then
      raise exception 'session: invalid changes' using errcode = 'P0001';
    end if;
  end loop;
  select * into s from public.class_session where club_id = v_club and id = p_session;
  if not found then perform app.refuse('session_not_available'); end if;
  -- Locks: both coaches in id order, the session, its seats, then the court locks.
  for v_lock in select distinct x from unnest(array[s.coach_id, coalesce(nullif(c ->> 'coach_id', '')::uuid, s.coach_id)]) x order by x loop
    perform app.lock_coach(v_lock);
  end loop;
  select * into s from public.class_session where club_id = v_club and id = p_session for update;
  if s.status <> 'scheduled' then perform app.refuse('session_not_available'); end if;
  if s.start_at <= app.now() then perform app.refuse('hour_started'); end if;
  perform 1 from public.booking where club_id = v_club and class_session_id = p_session and status in ('awaiting_payment', 'confirmed') order by id for update;

  n := s;
  begin
    if c ? 'name_th' then n.name_th := c ->> 'name_th'; end if;
    if c ? 'name_en' then n.name_en := c ->> 'name_en'; end if;
    if c ? 'level' then n.level := nullif(c ->> 'level', ''); end if;
    if c ? 'coach_id' then n.coach_id := (c ->> 'coach_id')::uuid; end if;
    if c ? 'resource_id' then n.resource_id := (c ->> 'resource_id')::uuid; end if;
    if c ? 'start_at' then n.start_at := (c ->> 'start_at')::timestamptz; n.end_at := n.start_at + interval '1 hour'; end if;
    if c ? 'min_players' then n.min_players := (c ->> 'min_players')::smallint; end if;
    if c ? 'max_players' then n.max_players := (c ->> 'max_players')::smallint; end if;
    if c ? 'drop_in_price_satang' then n.drop_in_price_satang := (c ->> 'drop_in_price_satang')::integer; end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'session: invalid changes' using errcode = 'P0001';
  end;
  select count(*) into v_taken from public.booking bk
   where bk.club_id = v_club and bk.class_session_id = p_session and (bk.status = 'confirmed' or (bk.status = 'awaiting_payment' and bk.hold_expires_at > app.now()));
  if n.max_players < v_taken then perform app.refuse('below_taken'); end if;
  if n.start_at <= app.now() then perform app.refuse('in_the_past'); end if;

  v_moved := n.coach_id <> s.coach_id or n.resource_id <> s.resource_id or n.start_at <> s.start_at;
  if v_moved then
    -- The same checks as a template: the hour, the court, the coach (availability, leave, rest). This session's own row is ignored.
    v_problem := app.class_hour_problem(n.coach_id, n.resource_id, n.start_at, s.template_id);
    if v_problem is not null and not (v_problem = 'court_clash' and exists (
         select 1 from public.occupancy o where o.club_id = v_club and o.class_session_id = p_session and o.resource_id = n.resource_id
            and o.start_at = n.start_at)) then
      perform app.refuse(v_problem);
    end if;
  end if;
  begin
    if v_moved then
      perform app.lock_resource(x) from unnest(case when n.resource_id < s.resource_id then array[n.resource_id, s.resource_id] else array[s.resource_id, n.resource_id] end) x group by x order by x;
      update public.occupancy set coach_id = n.coach_id, resource_id = n.resource_id, start_at = n.start_at, end_at = n.end_at
       where club_id = v_club and class_session_id = p_session;
      update public.booking set start_at = n.start_at, end_at = n.end_at, resource_id = n.resource_id, updated_at = app.now()
       where club_id = v_club and class_session_id = p_session and status in ('awaiting_payment', 'confirmed');
    end if;
    update public.class_session set name_th = n.name_th, name_en = n.name_en, level = n.level, coach_id = n.coach_id, resource_id = n.resource_id,
           start_at = n.start_at, end_at = n.end_at, min_players = n.min_players, max_players = n.max_players,
           drop_in_price_satang = n.drop_in_price_satang, edited = true
     where club_id = v_club and id = p_session;
  exception
    when exclusion_violation then perform app.refuse('court_clash');
    when unique_violation then raise exception 'session: invalid changes' using errcode = 'P0001';
    when check_violation or foreign_key_violation then raise exception 'session: invalid changes' using errcode = 'P0001';
  end;
  for b in select id, customer_id from public.booking where club_id = v_club and class_session_id = p_session and status in ('awaiting_payment', 'confirmed') order by id loop
    perform app.coach_message_hook('class_session_changed', b.customer_id, jsonb_build_object('booking_id', b.id, 'session_id', p_session),
                                   'class_session_changed:' || p_session || ':' || b.id || ':' || md5(c::text));
  end loop;
  if v_moved and n.coach_id <> s.coach_id then
    perform app.coach_message_hook('session_change', s.coach_id, jsonb_build_object('session_id', p_session), 'session_change:' || p_session || ':' || md5(c::text) || ':old');
    perform app.coach_message_hook('session_change', n.coach_id, jsonb_build_object('session_id', p_session), 'session_change:' || p_session || ':' || md5(c::text) || ':new');
  end if;
end $$;

create function app.apply_template_edit(p_template uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  t public.class_template%rowtype;
  s record;
  v_problem text;
  v_rewritten integer := 0;
  v_cancelled integer := 0;
  v_window text := app.club_setting_text('booking_window_days');
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_made integer := 0;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner') then
    raise exception 'session: not allowed' using errcode = '42501';
  end if;
  select * into t from public.class_template where club_id = v_club and id = p_template;
  if not found then perform app.refuse('session_not_available'); end if;
  perform app.lock_coach(x) from (select distinct coach_id x from (select t.coach_id as coach_id union select coach_id from public.class_session where club_id = v_club and template_id = p_template and start_at > app.now()) q order by 1) z;
  for s in
    select cs.* from public.class_session cs
     where cs.club_id = v_club and cs.template_id = p_template and cs.start_at > app.now() and cs.status in ('scheduled', 'needs_attention') and not cs.edited
       and not exists (select 1 from public.booking b where b.club_id = v_club and b.class_session_id = cs.id
                        and (b.status = 'confirmed' or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now())))
     order by cs.resource_id, cs.start_at
     for update
  loop
    if extract(dow from s.start_at at time zone 'Asia/Bangkok')::int <> t.weekday or (s.start_at at time zone 'Asia/Bangkok')::time <> t.start_time or not t.active
       or (t.ended_on is not null and (s.start_at at time zone 'Asia/Bangkok')::date > t.ended_on) then
      -- The class moved to another day or hour (or ended): this empty session goes, the new dates are generated below.
      perform app.cancel_session(s.id, 'template');
      v_cancelled := v_cancelled + 1;
      continue;
    end if;
    v_problem := app.class_hour_problem(t.coach_id, t.resource_id, s.start_at, p_template);
    perform app.lock_resource(x) from unnest(case when t.resource_id < s.resource_id then array[t.resource_id, s.resource_id] else array[s.resource_id, t.resource_id] end) x group by x order by x;
    if v_problem is null then
      if s.status = 'scheduled' then
        update public.occupancy set coach_id = t.coach_id, resource_id = t.resource_id where club_id = v_club and class_session_id = s.id;
      else
        insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id)
        values (v_club, 'group_class', t.resource_id, t.coach_id, s.start_at, s.end_at, 'confirmed', s.id);
      end if;
    elsif s.status = 'scheduled' then
      delete from public.occupancy where club_id = v_club and class_session_id = s.id;
    end if;
    update public.class_session set name_th = t.name_th, name_en = t.name_en, level = t.level, coach_id = t.coach_id, resource_id = t.resource_id,
           min_players = t.min_players, max_players = t.max_players, drop_in_price_satang = t.drop_in_price_satang,
           status = case when v_problem is null then 'scheduled' else 'needs_attention' end, attention_reason = v_problem
     where club_id = v_club and id = s.id;
    v_rewritten := v_rewritten + 1;
  end loop;
  if v_window ~ '^[0-9]+$' then
    v_made := app.generate_sessions(v_today, v_today + v_window::int);
  end if;
  return jsonb_build_object('rewritten', v_rewritten, 'cancelled', v_cancelled, 'generated', v_made);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.cancel_session(uuid, text)', 'app.edit_session(uuid, jsonb)', 'app.apply_template_edit(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
