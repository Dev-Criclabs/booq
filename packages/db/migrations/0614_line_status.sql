-- F10-T15 / migration 0614: app.line_status(), what the owner's club admin banners read (F10 design 5.7 to 5.9, 6;
-- GET /staff/line/status). Requirements LINE-06, LINE-07-AC1; decisions D98 (the cap alert in the pause banner
-- style), D114 (the token failure banner, shown to the owner only). Club roles have no access to the platform
-- schema (migration 0001); this definer reads the caller's own club's usage row and health checks and returns counts,
-- states and codes only, never message content or the token.
--   {month, state, used, limit, percent, plan, token: {status, reason} | null, usage: {status, reason} | null}
-- state is app.cap_state() (normal, alert, reminders_stopped, over_limit); percent is the whole percent used, null
-- when no limit is known. Owner only: any other role is refused.
create function app.line_status() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_month date := date_trunc('month', app.now() at time zone 'Asia/Bangkok')::date;
  u platform.club_line_usage%rowtype;
  v_plan text;
  v_token jsonb;
  v_usage jsonb;
begin
  if v_club is null or not app.has_any_role('owner') then
    raise exception 'line_status is for the club owner' using errcode = '42501';
  end if;
  select * into u from platform.club_line_usage where club_id = v_club and month = v_month;
  select l.line_plan_kind into v_plan from public.line_connection l where l.club_id = v_club;
  select jsonb_build_object('status', h.status, 'reason', h.reason) into v_token from platform.club_health h where h.club_id = v_club and h.check_key = 'line_token';
  select jsonb_build_object('status', h.status, 'reason', h.reason) into v_usage from platform.club_health h where h.club_id = v_club and h.check_key = 'line_usage';
  return jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'state', app.cap_state(),
    'used', coalesce(u.used, 0),
    'limit', u.message_limit,
    'percent', case when u.message_limit is not null then floor(u.used * 100.0 / u.message_limit)::integer end,
    'plan', coalesce(u.plan_kind, v_plan),
    'token', v_token,
    'usage', v_usage);
end $$;
alter function app.line_status() owner to booq_owner;
revoke all on function app.line_status() from public;
grant execute on function app.line_status() to booq_app;
