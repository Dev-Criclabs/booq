-- F10-T13 / migration 0613: the database side of line_usage_sync and line_health (F10 design 5.7 to 5.9, 8; FA 5.4,
-- 5.6). Requirements LINE-06, LINE-07-AC1 to AC6, AC9, AC10; decisions D17, D97, D99, D114.
--   app.line_sync_clubs()                the clubs both jobs visit: Testing, Live and Paused (a Testing club's messages
--                                        count toward its cap, D32); no club in the context needed
--   app.record_line_usage(quota_type, quota_value, quota_error, consumption, consumption_error)
--                                        writes this Bangkok month's platform.club_line_usage row from LINE's figures,
--                                        the line_usage and line_token health, voids queued reminders at 80 percent
--                                        and over, and tells the owner once a month at 100 percent on a paid plan
--   app.record_line_token_check(error)   the daily token check of line_health
-- The worker (apps/worker/src/tasks/line-usage.ts) calls LINE outside any transaction and passes the answers here as
-- values or error codes (packages/line usage API: unreachable, token_rejected, http_NNN, bad_answer, or no_token when
-- the club has no token). Nothing here calls LINE or reads a token.

create function app.line_sync_clubs() returns setof uuid
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select c.id from public.club c where c.status in ('testing', 'live', 'paused') order by c.id $$;
alter function app.line_sync_clubs() owner to booq_owner;
revoke all on function app.line_sync_clubs() from public;
grant execute on function app.line_sync_clubs() to booq_worker;

-- One health check of a club: p_reason null is ok, else failed with that code. changed_at moves only on a change of
-- status. Called by the definer functions below only (no grant).
create function app.f10_set_health(p_club uuid, p_check text, p_reason text) returns void
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  insert into platform.club_health as h (club_id, check_key, status, reason)
  values (p_club, p_check, case when p_reason is null then 'ok' else 'failed' end, p_reason)
  on conflict (club_id, check_key) do update
    set status = excluded.status, reason = excluded.reason, checked_at = app.now(),
        changed_at = case when h.status = excluded.status then h.changed_at else app.now() end
$$;
alter function app.f10_set_health(uuid, text, text) owner to booq_owner;
revoke all on function app.f10_set_health(uuid, text, text) from public;

-- FA 5.6, in order:
--  * the limit: a "limited" quota's value; else (none, or the call failed) line_connection.plan_message_limit from P2
--    step 4; else unknown, the state stays normal and line_usage fails with no_limit;
--  * used: LINE's totalUsage when it was read (LINE's count decides, D99; a drop is LINE's own rollover and resets the
--    estimate at once). When it could not be read, the last known value of this month (which record_send_result has
--    kept counting since, D97), or with no row yet our own count: the messages the outbox sent this Bangkok month,
--    one per recipient, Testing rows included (D32). A failed read fails line_usage with its code; reminders are
--    not stopped for that (D97);
--  * a refused token on either call fails line_token (P1 and the owner banner; the owner is not told by LINE,
--    D114); a call that worked clears it;
--  * at 80 percent and over the club's pending reminders are voided with cap, never revived (LINE-07-AC2);
--  * at 100 percent on a paid plan the owner gets owner_cap_paid_over once for the month (FA 5.6 step 5,
--    dedupe_key cap_paid_over:YYYY-MM); the owner is the club's person with the owner LINE id of setup step 1
--    (D122, as platform.enqueue_owner_message). No such person yet: no message.
-- Returns {state, used, limit, source, voided, owner_message}: counts and states only.
create function app.record_line_usage(p_quota_type text, p_quota_value integer, p_quota_error text, p_consumption integer, p_consumption_error text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_month date := date_trunc('month', app.now() at time zone 'Asia/Bangkok')::date;
  v_plan text;
  v_plan_limit integer;
  v_limit integer;
  u platform.club_line_usage%rowtype;
  v_used integer;
  v_line integer;
  v_source text;
  v_synced timestamptz;
  v_read_error text;
  v_state text;
  v_voided integer := 0;
  v_owner uuid;
  v_before integer;
  v_told boolean := false;
begin
  if v_club is null then
    raise exception 'record_line_usage needs a club in the context' using errcode = '42501';
  end if;
  if p_quota_type is not null and p_quota_type not in ('none', 'limited') then
    raise exception 'record_line_usage: unknown quota type %', p_quota_type using errcode = '22023';
  end if;
  if p_consumption is not null and p_consumption < 0 then
    raise exception 'record_line_usage: a negative consumption' using errcode = '22023';
  end if;

  select l.line_plan_kind, l.plan_message_limit into v_plan, v_plan_limit from public.line_connection l where l.club_id = v_club;
  v_limit := case when p_quota_type = 'limited' and p_quota_value > 0 then p_quota_value else v_plan_limit end;

  select * into u from platform.club_line_usage where club_id = v_club and month = v_month for update;
  if p_consumption is not null then
    v_used := p_consumption; v_line := p_consumption; v_source := 'line'; v_synced := app.now();
  elsif found then
    v_used := u.used; v_line := u.line_consumption; v_source := u.source; v_synced := u.synced_at;
  else
    select count(*)::integer into v_used from public.message_outbox o
     where o.club_id = v_club and o.status = 'sent'
       and o.sent_at >= (v_month::timestamp at time zone 'Asia/Bangkok')
       and o.sent_at < ((v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok');
    v_line := null; v_source := 'own_count'; v_synced := null;
  end if;
  insert into platform.club_line_usage as x (club_id, month, used, line_consumption, message_limit, plan_kind, source, synced_at)
  values (v_club, v_month, v_used, v_line, v_limit, v_plan, v_source, v_synced)
  on conflict (club_id, month) do update
    set used = excluded.used, line_consumption = excluded.line_consumption, message_limit = excluded.message_limit,
        plan_kind = excluded.plan_kind, source = excluded.source, synced_at = excluded.synced_at;

  -- Health.
  if 'token_rejected' in (coalesce(p_quota_error, ''), coalesce(p_consumption_error, '')) then
    perform app.f10_set_health(v_club, 'line_token', 'token_rejected');
  elsif p_quota_error is null or p_consumption_error is null then
    update platform.club_health set status = 'ok', reason = null, changed_at = app.now(), checked_at = app.now()
     where club_id = v_club and check_key = 'line_token' and status = 'failed';
  end if;
  v_read_error := coalesce(p_consumption_error, p_quota_error);
  perform app.f10_set_health(v_club, 'line_usage', case when v_read_error is not null then v_read_error when v_limit is null then 'no_limit' end);

  -- The cap.
  v_state := app.cap_state();
  if v_state in ('reminders_stopped', 'over_limit') then
    v_voided := app.void_cap_reminders();
  end if;
  if v_state = 'over_limit' and v_plan = 'paid' then
    select uu.id into v_owner from public.club c join public.app_user uu on uu.club_id = c.id and uu.line_user_id = c.owner_line
     where c.id = v_club and c.owner_line is not null;
    if v_owner is not null then
      select count(*)::integer into v_before from public.message_outbox
       where club_id = v_club and dedupe_key = 'cap_paid_over:' || to_char(v_month, 'YYYY-MM');
      if app.enqueue_message('owner_cap_paid_over', v_owner, '{}'::jsonb, 'cap_paid_over:' || to_char(v_month, 'YYYY-MM'), null) is not null then
        v_told := v_before = 0;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', v_state, 'used', v_used, 'limit', v_limit, 'source', v_source, 'voided', v_voided, 'owner_message', v_told);
end $$;
alter function app.record_line_usage(text, integer, text, integer, text) owner to booq_owner;
revoke all on function app.record_line_usage(text, integer, text, integer, text) from public;
grant execute on function app.record_line_usage(text, integer, text, integer, text) to booq_worker;

-- line_health (daily, design 5.7): the bot's quota read with the club's token. null: the token works (clears a failed
-- check); token_rejected or no_token: the check fails with that code; any other code (LINE unreachable, a 5xx) says
-- nothing about the token and changes nothing. Returns ok, failed or unchanged.
create function app.record_line_token_check(p_error text) returns text
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null then
    raise exception 'record_line_token_check needs a club in the context' using errcode = '42501';
  end if;
  if p_error is null then
    perform app.f10_set_health(v_club, 'line_token', null);
    return 'ok';
  elsif p_error in ('token_rejected', 'no_token') then
    perform app.f10_set_health(v_club, 'line_token', p_error);
    return 'failed';
  end if;
  return 'unchanged';
end $$;
alter function app.record_line_token_check(text) owner to booq_owner;
revoke all on function app.record_line_token_check(text) from public;
grant execute on function app.record_line_token_check(text) to booq_worker;
