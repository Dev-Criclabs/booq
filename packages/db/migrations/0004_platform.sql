-- F01-T16 / migration 0004: the platform schema (BOOQ's own data) and usage counts.
-- F01 design 3.2 and 6.3; FA 4.4 and 8.2. Requirements: PLAT-02-AC10, AC11, PLAT-04-AC5.
--
-- Class P tables hold no club data. Nothing here is granted to booq_platform, booq_app,
-- booq_worker, anon or authenticated: the default is no access. Grants and row policies for
-- BOOQ staff are written together in F01-T18 so the blind suite can prove them in one place.
-- Identity is Supabase Auth (email plus second factor); no password or secret is stored here.

create table platform.platform_staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  email text not null check (email <> ''),
  display_name text not null check (display_name <> ''),
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default app.now(),
  constraint platform_staff_role_values check (role in ('platform_admin', 'onboarding_specialist')),
  constraint platform_staff_auth_user_unique unique (auth_user_id)
);
create unique index platform_staff_email_unique on platform.platform_staff (lower(email));

create table platform.staff_assignment (
  staff_id uuid not null references platform.platform_staff (id),
  club_id uuid not null references public.club (id),
  assigned_at timestamptz not null default app.now(),
  primary key (staff_id, club_id)
);

create table platform.support_session (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references platform.platform_staff (id),
  club_id uuid not null references public.club (id),
  opened_at timestamptz not null default app.now(),
  closed_at timestamptz,
  mode text not null,
  constraint support_session_mode_values check (mode in ('edit', 'look')),
  constraint support_session_order check (closed_at is null or closed_at >= opened_at)
);

-- P6 (FA 8.2): setup-level facts only. staff_id is null for a failed sign in by an unknown
-- address. Append-only; the writer functions come with the platform app (F01-T17).
create table platform.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default app.now(),
  staff_id uuid references platform.platform_staff (id),
  staff_name_at_time text,
  action text not null check (action <> ''),
  club_id uuid references public.club (id),
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  reason text,
  support_session_id uuid references platform.support_session (id)
);
create trigger audit_log_append_only before update or delete on platform.audit_log
  for each row execute function app.refuse_change();
create trigger audit_log_no_truncate before truncate on platform.audit_log
  for each statement execute function app.refuse_change();

-- Counts per club per day and nothing finer (decision D2, PLAT-02-AC11).
create table platform.club_usage_daily (
  club_id uuid not null references public.club (id),
  day date not null,
  metric text not null,
  value integer not null check (value > 0),
  primary key (club_id, day, metric),
  constraint club_usage_metric_values check (metric in ('bookings_confirmed', 'line_messages_sent'))
);

create table platform.config (
  key text primary key check (key <> ''),
  value jsonb not null
);

create table platform.template (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key <> ''),
  name text not null check (name <> ''),
  to_build boolean not null default false,   -- Padel and Pickleball exist but cannot be chosen (PLAT-05-AC11)
  constraint template_key_unique unique (key)
);

create table platform.template_item (
  template_id uuid not null references platform.template (id),
  kind text not null check (kind <> ''),
  key text not null check (key <> ''),
  value jsonb not null,
  primary key (template_id, kind, key)
);

-- Pass, fail or pending only: no test content (PLAT-07-AC6).
create table platform.launch_check (
  club_id uuid not null references public.club (id),
  check_key text not null check (check_key <> ''),
  result text not null,
  checked_at timestamptz,
  checked_by uuid references platform.platform_staff (id),
  primary key (club_id, check_key),
  constraint launch_check_result_values check (result in ('pass', 'fail', 'pending'))
);

create table platform.export_request (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club (id),
  requested_by_staff uuid not null references platform.platform_staff (id),
  requested_at timestamptz not null default app.now(),
  status text not null default 'requested',
  constraint export_request_status_values check (status in ('requested', 'running', 'done', 'failed'))
);

-- The two columns 0002 left open.
alter table public.club add constraint club_created_by_staff_fk foreign key (created_by_staff) references platform.platform_staff (id);
alter table public.club add constraint club_template_fk foreign key (template_id) references platform.template (id);

do $$
declare t text;
begin
  foreach t in array array['platform_staff', 'staff_assignment', 'support_session', 'audit_log', 'club_usage_daily',
                           'config', 'template', 'template_item', 'launch_check', 'export_request'] loop
    execute format('alter table platform.%I owner to booq_owner', t);
    execute format('revoke all on platform.%I from public', t);
  end loop;
end $$;

-- The one writer of club_usage_daily. SECURITY DEFINER with a fixed search path; the club comes
-- from app.club_id() and never from an argument (no club can be named by a caller). It lives in
-- the app schema because the app roles have no access to the platform schema (migration 0001);
-- the booq_platform role cannot run it. Activity of a club that is not Live or Paused (Draft or
-- Testing) is test activity and is not counted: the function returns false.
create function app.bump_usage(metric text, by integer) returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_status text;
begin
  if v_club is null then
    raise exception 'bump_usage: no club context' using errcode = 'P0001';
  end if;
  if metric is null or metric not in ('bookings_confirmed', 'line_messages_sent') then
    raise exception 'bump_usage: unknown metric' using errcode = 'P0001';
  end if;
  if by is null or by < 1 then
    raise exception 'bump_usage: by must be 1 or more' using errcode = 'P0001';
  end if;
  select c.status into v_status from public.club c where c.id = v_club;
  if v_status is null or v_status not in ('live', 'paused') then
    return false;
  end if;
  insert into platform.club_usage_daily as u (club_id, day, metric, value)
    values (v_club, (app.now() at time zone 'Asia/Bangkok')::date, metric, by)
    on conflict on constraint club_usage_daily_pkey do update set value = u.value + excluded.value;
  return true;
end $$;
alter function app.bump_usage(text, integer) owner to booq_owner;
revoke all on function app.bump_usage(text, integer) from public;
grant execute on function app.bump_usage(text, integer) to booq_app, booq_worker;

-- The definer function runs as booq_owner, which row level security also binds (FORCE). It may
-- read only the caller's own club row, and only to look at the status.
create policy club_owner_role_read on public.club for select to booq_owner using (id = app.club_id());
