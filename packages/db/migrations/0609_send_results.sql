-- F10-T09 / migration 0609: the sender's results (F10 design 5.2 steps 5 to 7, 5.7; FA 5.3, 5.6). Requirements
-- LINE-03-AC5, AC9, LINE-07-AC5, LINE-06; decisions D9, D32, D114.
--   app.record_send_result(message, outcome, code)  what a push did to the row, the usage counts and the token health
--
-- Retry rules (assumption A-3): how many attempts and how long to wait are platform config with no default; the
-- PRD and hand-off give no number. JSON null means "not configured" (as 0016 and 0409): until an admin sets them,
-- a row that can be retried stays pending for the next tick with the same retry key (LINE ignores a repeat, FA 5.3)
-- and is never marked failed on an invented limit.
--   line_send_max_attempts   pushes a row gets before it is failed
--   line_send_retry_seconds  the first wait; each later attempt waits twice as long
insert into platform.config (key, value) values
  ('line_send_max_attempts', 'null'::jsonb),
  ('line_send_retry_seconds', 'null'::jsonb)
on conflict (key) do nothing;

-- p_outcome: sent | retry | token | cap | failed (the transport's outcome, packages/line PushOutcome). For a row the
-- sender has locked and prepared (status pending). Returns the row's status afterwards.
--   sent     sent; counts once in platform.club_usage_daily (LINE-06; Live and Paused clubs, app.bump_usage) and in
--            this month's club_line_usage estimate (all clubs, Testing too, D32); a failed token check clears
--   cap      undeliverable, never retried (FA 5.6 step 4)
--   token    platform.club_health line_token failed (P1 and the owner banner, D114; the owner is not told by LINE,
--            LINE-03-AC9), then as retry
--   retry    pending again after the wait, or failed after the last attempt
--   failed   failed
create function app.record_send_result(p_message uuid, p_outcome text, p_code text) returns text
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_attempts integer;
  v_max integer := (select (c.value #>> '{}')::integer from platform.config c where c.key = 'line_send_max_attempts' and jsonb_typeof(c.value) = 'number');
  v_wait integer := (select (c.value #>> '{}')::integer from platform.config c where c.key = 'line_send_retry_seconds' and jsonb_typeof(c.value) = 'number');
  v_status text;
begin
  if v_club is null then
    raise exception 'record_send_result needs a club in the context' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'token', 'cap', 'failed') then
    raise exception 'record_send_result: unknown outcome %', p_outcome using errcode = '22023';
  end if;
  update public.message_outbox set attempts = attempts + 1
   where club_id = v_club and id = p_message and status = 'pending'
   returning attempts into v_attempts;
  if v_attempts is null then
    raise exception 'record_send_result: the message is not pending' using errcode = 'P0001';
  end if;

  if p_outcome = 'sent' then
    update public.message_outbox set status = 'sent', sent_at = app.now(), last_error = null where club_id = v_club and id = p_message;
    perform app.bump_usage('line_messages_sent', 1);
    update platform.club_line_usage set used = used + 1
     where club_id = v_club and month = date_trunc('month', app.now() at time zone 'Asia/Bangkok')::date;
    update platform.club_health set status = 'ok', reason = null, changed_at = app.now(), checked_at = app.now()
     where club_id = v_club and check_key = 'line_token' and status = 'failed';
    return 'sent';
  elsif p_outcome = 'cap' then
    update public.message_outbox set status = 'undeliverable', last_error = 'cap' where club_id = v_club and id = p_message;
    return 'undeliverable';
  elsif p_outcome = 'failed' then
    update public.message_outbox set status = 'failed', last_error = p_code where club_id = v_club and id = p_message;
    return 'failed';
  end if;

  if p_outcome = 'token' then
    insert into platform.club_health as h (club_id, check_key, status, reason) values (v_club, 'line_token', 'failed', coalesce(p_code, 'token'))
      on conflict (club_id, check_key) do update
        set status = 'failed', reason = excluded.reason, checked_at = app.now(),
            changed_at = case when h.status = 'failed' then h.changed_at else app.now() end;
  end if;
  v_status := case when v_max is not null and v_attempts >= v_max then 'failed' else 'pending' end;
  update public.message_outbox
     set status = v_status, last_error = p_code,
         send_at = case when v_status = 'pending' and v_wait is not null
                        then app.now() + make_interval(secs => v_wait * power(2, v_attempts - 1)) else send_at end
   where club_id = v_club and id = p_message;
  return v_status;
end $$;
alter function app.record_send_result(uuid, text, text) owner to booq_owner;
revoke all on function app.record_send_result(uuid, text, text) from public;
grant execute on function app.record_send_result(uuid, text, text) to booq_worker;
