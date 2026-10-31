-- F06-T14 / migration 0514: the expiry reminders of a package. F06 design 4.5; F10 design 5.4 (package_expiring).
-- Requirements: PKG-03-AC1, AC2, AC6, LINE-05-AC7; decisions D29, D116.
--
-- Replaces the no-op app.package_reminder_hook of 0508, which grant_package, extend_package, extend_for_pause and the
-- claim transfer already call. For a package it:
--   1. voids the package's pending package_expiring rows of an earlier expiry (reason superseded): an extension or a
--      pause moves the expiry, and the old dates must not be sent (PKG-03-AC6). The rows of the current expiry stay,
--      so calling the hook again changes nothing (a voided key is never revived, so voiding them would lose them);
--   2. queues one package_expiring message per value N of the club setting package_expiry_reminder_days (Tennis
--      template: 14 and 3; the numbers are never typed here, D116), sent at 09:00 Asia/Bangkok on the calendar day N
--      days before the expiry date (D169, the birthday message's precedent), keyed
--      package_expiring:{package}:{expires_at in UTC}:{N} as F10 design 5.4 has it. The expiry is in the key, so
--      after an extension the new rows never meet the voided ones (a voided key is never revived).
-- Nothing is queued when the package has no credits left, when the setting is unset, or for a reminder date that
-- has already passed (a package granted or extended with fewer than N days left gets no late "N days" message).
-- F10's sender checks again at send time and voids the message if the credits are gone by then (no_credits, 0608).
-- One message per N per expiry: a reminder already sent is never repeated (PKG-03-AC1). The message is class A, sent
-- even at 80 percent of the LINE cap (D29).
create or replace function app.package_reminder_hook(p_package uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.customer_package%rowtype;
  v_days jsonb;
  v_n jsonb;
  v_send_at timestamptz;
  v_prefix text;
  v_current text;
begin
  select * into p from public.customer_package cp where cp.club_id = v_club and cp.id = p_package;
  if not found then
    return;
  end if;
  v_prefix := 'package_expiring:' || p.id::text || ':';
  v_current := v_prefix || to_char(p.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || ':';
  -- As app.void_messages (F10 0605) does, but keeping the current expiry's rows, which a prefix alone cannot express.
  update public.message_outbox
     set status = 'void', void_reason = 'superseded'
   where club_id = v_club and status = 'pending'
     and left(dedupe_key, length(v_prefix)) = v_prefix and left(dedupe_key, length(v_current)) <> v_current;
  if coalesce(app.package_credits_left(p.id), 0) <= 0 then
    return;
  end if;
  select s.value into v_days from public.club_setting s where s.club_id = v_club and s.key = 'package_expiry_reminder_days';
  if v_days is null or jsonb_typeof(v_days) <> 'array' then
    return;
  end if;
  for v_n in select * from jsonb_array_elements(v_days) loop
    v_send_at := (((p.expires_at at time zone 'Asia/Bangkok')::date - (v_n #>> '{}')::integer) + time '09:00') at time zone 'Asia/Bangkok';
    continue when v_send_at <= app.now();
    perform app.enqueue_message('package_expiring', p.customer_id, jsonb_build_object('package_id', p.id),
                                v_current || (v_n #>> '{}'),
                                v_send_at);
  end loop;
end $$;
alter function app.package_reminder_hook(uuid) owner to booq_owner;
revoke all on function app.package_reminder_hook(uuid) from public;
