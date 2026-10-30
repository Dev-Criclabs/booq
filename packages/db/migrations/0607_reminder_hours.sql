-- F10-T07b / migration 0607: the reminder hours and the booking reminder enqueue. Requirements LINE-05; decisions
-- D116, D96. The PRD change log row "Scope" fixes reminders at 24 h and 2 h before start, and D116 makes those
-- numbers settings in code and variables in the text: product constants, never a club setting (orchestrator, 30 Oct).
-- They live in the message catalogue (one row per reminder kind), and packages/domain/src/messages/reminders.ts holds
-- the same values; a test keeps them equal.
--   app.enqueue_booking_reminders(booking)  queues a confirmed booking's reminders, for F03's confirm and move

alter table app.message_kinds add column hours_before smallint;
update app.message_kinds set hours_before = 24 where kind = 'reminder_24h';
update app.message_kinds set hours_before = 2 where kind = 'reminder_2h';
alter table app.message_kinds add constraint message_kinds_hours_only_reminders
  check ((cap_class = 'R') = (hours_before is not null and hours_before > 0));

-- Queues one reminder per reminder kind for a confirmed booking of the caller's club, at start minus the kind's hours,
-- with the dedupe key reminder:{booking}:{start, UTC minute}:{hours} (design 5.4). enqueue_message drops a reminder
-- whose hour has passed and every reminder at 80 percent and over. A move: the caller voids the prefix
-- reminder:{booking}: with reason moved, then calls this again; the new start makes new keys. Returns how many
-- reminders the booking has queued (a repeat finds the same rows).
create function app.enqueue_booking_reminders(p_booking uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
  k record;
  v_n integer := 0;
begin
  if v_club is null then
    raise exception 'enqueue_booking_reminders needs a club in the context' using errcode = '42501';
  end if;
  select * into b from public.booking where club_id = v_club and id = p_booking and status = 'confirmed';
  if not found or b.customer_id is null then
    return 0;
  end if;
  for k in select kind, hours_before from app.message_kinds where hours_before is not null order by hours_before desc loop
    if app.enqueue_message(k.kind, b.customer_id, jsonb_build_object('booking_id', b.id),
                           'reminder:' || b.id::text || ':' || to_char(b.start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')
                             || ':' || k.hours_before::text,
                           b.start_at - make_interval(hours => k.hours_before)) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
alter function app.enqueue_booking_reminders(uuid) owner to booq_owner;
revoke all on function app.enqueue_booking_reminders(uuid) from public;
grant execute on function app.enqueue_booking_reminders(uuid) to booq_worker;
