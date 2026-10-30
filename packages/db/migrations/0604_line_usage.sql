-- F10-T05 / migration 0604: platform.club_line_usage, platform.club_health and the cap thresholds.
-- FA 2.2 and 5.6; F10 design 5.7 to 5.9. Requirements LINE-06, LINE-07-AC8; decisions D17, D97, D99.
-- Class P: counts and health only, never message content. Written only by definer functions (F10-T06,
-- T09, T13) running as booq_owner. The platform reader sees the clubs it may see; club roles have no
-- access to the platform schema (migration 0001). The club admin banner reads its own club's state
-- through app.cap_state (F10-T06), not through a grant here.

-- One row per club and Bangkok calendar month (FA 5.6: LINE's month boundary is not documented).
-- used is the current estimate: line_consumption at the last sync plus what our outbox sent since, or our
-- own count when LINE cannot be read (source own_count), or the last known value (D97). The state
-- (normal, alert, reminders_stopped, over_limit) is derived from used, message_limit and the thresholds
-- below, never stored (F10 design 7).
create table platform.club_line_usage (
  club_id uuid not null references public.club (id),
  month date not null,
  used integer not null default 0,
  line_consumption integer,                    -- LINE's totalUsage at the last sync (approximate, FA 5.6)
  message_limit integer,                       -- the quota value, else line_connection.plan_message_limit; null: unknown
  plan_kind text,                              -- from line_connection (P2 step 4); LINE's API does not return it
  source text not null,
  synced_at timestamptz,
  primary key (club_id, month),
  constraint club_line_usage_month_first_day check (extract(day from month) = 1),
  constraint club_line_usage_used_non_negative check (used >= 0),
  constraint club_line_usage_consumption_non_negative check (line_consumption is null or line_consumption >= 0),
  constraint club_line_usage_limit_positive check (message_limit is null or message_limit > 0),
  constraint club_line_usage_plan_kind_values check (plan_kind in ('free', 'paid')),
  constraint club_line_usage_source_values check (source in ('line', 'own_count'))
);

-- A club's health for the checks F10 runs (F10 design 5.7, 5.8): the LINE token, and whether usage could
-- be read or the cap computed. A failure carries a reason code; the P1 alert and the owner banner read it.
create table platform.club_health (
  club_id uuid not null references public.club (id),
  check_key text not null,
  status text not null,
  reason text,                                 -- a code (http_401, usage_unreadable, no_limit ...), never a message
  changed_at timestamptz not null default app.now(),
  checked_at timestamptz not null default app.now(),
  primary key (club_id, check_key),
  constraint club_health_check_values check (check_key in ('line_token', 'line_usage')),
  constraint club_health_status_values check (status in ('ok', 'failed')),
  constraint club_health_failed_has_reason check ((status = 'failed') = (reason is not null))
);

do $$
declare t text;
begin
  foreach t in array array['club_line_usage', 'club_health'] loop
    execute format('alter table platform.%I owner to booq_owner', t);
    execute format('revoke all on platform.%I from public', t);
    execute format('alter table platform.%I enable row level security', t);
    execute format('grant select on platform.%I to booq_platform', t);
    execute format('create policy %1$s_select on platform.%1$I for select to booq_platform using (platform.can_see_club(club_id))', t);
  end loop;
end $$;

-- The thresholds of LINE-07 (PRD "LINE message cap", decided 30 Oct 2026; hand-off LINE-07): alert at 70
-- percent, reminders stop at 80, over the limit at 100. The same for every club and not club settings
-- (LINE-07-AC8). They are constants of the product: a change is a new migration, not a console edit.
insert into platform.config (key, value) values
  ('line_cap_alert_percent', '70'::jsonb),
  ('line_cap_reminders_stop_percent', '80'::jsonb),
  ('line_cap_over_limit_percent', '100'::jsonb);

create function platform.keep_line_cap_constants() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if old.key like 'line\_cap\_%' then
    raise exception 'platform config %: the LINE cap thresholds are constants (LINE-07-AC8)', old.key using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
alter function platform.keep_line_cap_constants() owner to booq_owner;
revoke all on function platform.keep_line_cap_constants() from public;
create trigger config_line_cap_constant before update or delete on platform.config
  for each row execute function platform.keep_line_cap_constants();
