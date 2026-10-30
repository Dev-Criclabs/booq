-- F10-T08 / migration 0608: the database side of the sender, steps 1 to 4 of F10 design 5.2 (FA 5.3).
-- Requirements LINE-03-AC1 to AC3, LINE-05; decisions D93, D94, D32, D9.
--   app.due_message_clubs(limit)      the clubs with pending messages due now, across clubs (Testing clubs too:
--                                     their messages are sent and count toward the cap, D32; app.worker_club_ids
--                                     lists Live and Paused only)
--   app.prepare_message_send(message) for a row the sender has locked: applies the send time preconditions and the
--                                     cap gate (void or undeliverable, with the reason) or says what to send, with
--                                     the recipient's LINE id and the language read now (D93)
-- The sender (apps/worker/src/tasks/line-outbox-sender.ts) claims rows with FOR UPDATE SKIP LOCKED in the club's
-- context, calls prepare_message_send on each, builds and pushes the "send" ones and records the result.

create function app.due_message_clubs(p_limit integer) returns setof uuid
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select o.club_id from public.message_outbox o
   where o.status = 'pending' and o.send_at <= app.now()
   group by o.club_id order by min(o.send_at) limit greatest(coalesce(p_limit, 0), 0)
$$;

create function app.prepare_message_send(p_message uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  m public.message_outbox%rowtype;
  k app.message_kinds%rowtype;
  u public.app_user%rowtype;
  b public.booking%rowtype;
  v_state text;
  v_void text;
  v_on boolean;
begin
  if v_club is null then
    raise exception 'prepare_message_send needs a club in the context' using errcode = '42501';
  end if;
  select * into m from public.message_outbox where club_id = v_club and id = p_message;
  if not found or m.status <> 'pending' then
    return jsonb_build_object('action', 'skip');
  end if;
  select * into k from app.message_kinds where kind = m.kind;
  select * into u from public.app_user where club_id = v_club and id = m.user_id;

  -- Step 1: preconditions at send time (design 5.4, the precondition column).
  if k.hours_before is not null then
    -- A reminder belongs to the booking at the start in its key; a cancel or a move makes it stale.
    select * into b from public.booking where club_id = v_club and id = (m.params ->> 'booking_id')::uuid;
    if not found or b.status <> 'confirmed' then
      v_void := 'cancelled';
    elsif left(m.dedupe_key, length('reminder:' || b.id::text || ':' || to_char(b.start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || ':'))
          <> 'reminder:' || b.id::text || ':' || to_char(b.start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') || ':' then
      v_void := 'moved';
    end if;
  elsif m.kind = 'package_expiring' and m.params ? 'package_id' then
    if coalesce(app.package_credits_left((m.params ->> 'package_id')::uuid), 0) <= 0 then
      v_void := 'no_credits';
    end if;
  elsif m.kind = 'booking_released' and m.params ? 'order_id' then
    -- Taken back by a late payment before the message went: nothing to tell.
    if exists (select 1 from public.booking x where x.club_id = v_club and x.order_id = (m.params ->> 'order_id')::uuid and x.status = 'confirmed') then
      v_void := 'superseded';
    end if;
  end if;
  -- The person's switch (D94); no row means the defaults: reminders on, promotions off (A-2).
  if v_void is null and k.switch_key is not null then
    select case k.switch_key when 'reminders' then p.reminders when 'promotions' then p.promotions end into v_on
      from public.notification_pref p where p.club_id = v_club and p.user_id = m.user_id;
    if not coalesce(v_on, k.switch_key = 'reminders') then
      v_void := 'switch_off';
    end if;
  end if;

  -- Step 2: the cap gate (design 5.9). A reminder at 80 percent and over is voided, never revived; on a free plan
  -- at 100 percent nothing can be sent (FA 5.6 step 4).
  v_state := app.cap_state();
  if v_void is null and k.cap_class = 'R' and v_state in ('reminders_stopped', 'over_limit') then
    v_void := 'cap';
  end if;
  if v_void is not null then
    update public.message_outbox set status = 'void', void_reason = v_void where club_id = v_club and id = m.id;
    return jsonb_build_object('action', 'void', 'reason', v_void);
  end if;
  if v_state = 'over_limit' and exists (
       select 1 from platform.club_line_usage x
        where x.club_id = v_club and x.month = date_trunc('month', app.now() at time zone 'Asia/Bangkok')::date and x.plan_kind = 'free') then
    update public.message_outbox set status = 'undeliverable', last_error = 'cap' where club_id = v_club and id = m.id;
    return jsonb_build_object('action', 'undeliverable', 'error', 'cap');
  end if;
  if u.line_user_id is null then
    update public.message_outbox set status = 'undeliverable', last_error = 'no_line_id' where club_id = v_club and id = m.id;
    return jsonb_build_object('action', 'undeliverable', 'error', 'no_line_id');
  end if;

  -- Steps 3 and 4: the language now (D93), else the club's default; the kind and params for the builder.
  return jsonb_build_object(
    'action', 'send',
    'to', u.line_user_id,
    'language', coalesce(u.language, (select c.default_language from public.club c where c.id = v_club)),
    'kind', m.kind,
    'params', m.params,
    'retry_key', m.retry_key);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.due_message_clubs(integer)', 'app.prepare_message_send(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_worker', f);
  end loop;
end $$;
