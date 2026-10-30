-- F01-T06 / migration 0002: the club and its setup data.
-- F01 design 3.2 and 6.3; FA 2.2 and 4.3. Requirements: PLAT-01, PLAT-05, CC-1, CC-4.
-- Secrets, LINE and payment connections follow in F01-T09. Policies for BOOQ staff
-- (booq_platform) and the per-role refinements are completed in migration 0008.
--
-- Every club table here: club_id first, unique (club_id, id) where it has an id, FORCE ROW
-- LEVEL SECURITY, a restrictive tenant policy (always ANDed) plus permissive policies that say
-- who in the club.

-- Reusable guard: rows that may never be changed or removed (history tables).
create function app.refuse_change() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;
alter function app.refuse_change() owner to booq_owner;
revoke all on function app.refuse_change() from public;

create table public.club (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name_th text not null,
  name_en text not null,
  legal_name text,
  tax_id text,
  tax_branch text,
  registered_address text,
  status text not null default 'draft',
  payment_option text,
  template_id uuid,                       -- references platform.template once migration 0004 exists
  receipt_prefix text,
  default_language text not null default 'th',
  owner_name text,
  owner_phone text,
  owner_line text,
  owner_email text,
  plan_trial_ends_at timestamptz,
  billing_starts_at timestamptz,
  allow_booq_changes_until timestamptz,
  allow_booq_changes_set_at timestamptz,
  created_at timestamptz not null default app.now(),
  created_by_staff uuid,                  -- platform staff id; foreign key added in 0004
  constraint club_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 63),
  constraint club_slug_unique unique (slug),
  constraint club_status_values check (status in ('draft', 'testing', 'live', 'paused')),
  constraint club_payment_option_values check (payment_option in ('beam', 'slip')),
  constraint club_default_language_values check (default_language in ('th', 'en')),
  constraint club_booq_window_max check (
    allow_booq_changes_until is null
    or (allow_booq_changes_set_at is not null
        and allow_booq_changes_until <= allow_booq_changes_set_at + interval '24 hours')
  )
);

-- The slug becomes part of the address /c/{slug}; it is fixed once the club leaves Draft.
create function app.club_slug_guard() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if new.slug is distinct from old.slug and old.status <> 'draft' then
    raise exception 'club slug cannot change after Draft' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.club_slug_guard() owner to booq_owner;
revoke all on function app.club_slug_guard() from public;
create trigger club_slug_guard before update on public.club
  for each row execute function app.club_slug_guard();

create table public.club_feature (
  club_id uuid not null references public.club (id),
  feature_key text not null check (feature_key <> ''),
  enabled boolean not null default false,
  primary key (club_id, feature_key)
);

create table public.club_setting (
  club_id uuid not null references public.club (id),
  key text not null check (key <> ''),
  value jsonb not null,
  updated_at timestamptz not null default app.now(),
  primary key (club_id, key)
);

create table public.location (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  name text not null check (name <> ''),
  primary key (club_id, id)      -- the primary key is the unique (club_id, id) the composite foreign keys use
);

create table public.resource (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  location_id uuid not null,
  name text not null check (name <> ''),
  sport text not null check (sport <> ''),
  type text,
  lights boolean not null default false,
  max_players integer check (max_players > 0),
  active boolean not null default true,    -- inactive cannot be booked and keeps its id (CC-4)
  primary key (club_id, id),
  foreign key (club_id, location_id) references public.location (club_id, id)
);

-- Weekday is ISO: 1 Monday to 7 Sunday. close may be 24:00 (open until midnight).
create table public.opening_hours (
  club_id uuid not null references public.club (id),
  weekday smallint not null check (weekday between 1 and 7),
  open time not null,
  close time not null,
  primary key (club_id, weekday),
  constraint opening_hours_order check (open < close and close <= time '24:00')
);

create table public.club_pause (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  paused_at timestamptz not null default app.now(),
  pause_reason text not null check (pause_reason <> ''),
  paused_by uuid not null,                -- platform staff id
  resumed_at timestamptz,
  resume_reason text,
  resumed_by uuid,
  primary key (club_id, id),
  constraint club_pause_resume_together check (
    (resumed_at is null and resume_reason is null and resumed_by is null)
    or (resumed_at is not null and coalesce(resume_reason, '') <> '' and resumed_by is not null)
  ),
  constraint club_pause_order check (resumed_at is null or resumed_at >= paused_at)
);
create unique index club_pause_one_open on public.club_pause (club_id) where resumed_at is null;

create table public.club_status_change (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  from_status text not null,
  to_status text not null,
  reason text not null check (reason <> ''),
  actor_staff_id uuid,
  occurred_at timestamptz not null default app.now(),
  primary key (club_id, id),
  constraint club_status_change_from check (from_status in ('draft', 'testing', 'live', 'paused')),
  constraint club_status_change_to check (to_status in ('draft', 'testing', 'live', 'paused'))
);
create trigger club_status_change_append_only before update or delete on public.club_status_change
  for each row execute function app.refuse_change();
create trigger club_status_change_no_truncate before truncate on public.club_status_change
  for each statement execute function app.refuse_change();

-- Ownership, RLS and grants -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['club', 'club_feature', 'club_setting', 'location', 'resource',
                           'opening_hours', 'club_pause', 'club_status_change'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
  end loop;
  foreach t in array array['club_feature', 'club_setting', 'location', 'resource', 'opening_hours',
                           'club_pause', 'club_status_change'] loop
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
  end loop;
end $$;

create policy club_tenant on public.club as restrictive for all to booq_app, booq_worker
  using (id = app.club_id()) with check (id = app.club_id());

-- Who in the club (the platform and finer role rules are completed in 0008).
-- Read: every club person sees the club, its switches, places and hours (a player needs them
-- to book). Settings, pauses and history are for staff roles. Write: the owner.
create policy club_read on public.club for select to booq_app, booq_worker using (true);
create policy club_owner_write on public.club for update to booq_app using (app.has_any_role('owner')) with check (app.has_any_role('owner'));

create policy club_feature_read on public.club_feature for select to booq_app, booq_worker using (true);
create policy location_read on public.location for select to booq_app, booq_worker using (true);
create policy resource_read on public.resource for select to booq_app, booq_worker using (true);
create policy opening_hours_read on public.opening_hours for select to booq_app, booq_worker using (true);
create policy club_setting_read on public.club_setting for select to booq_app
  using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy club_setting_worker on public.club_setting for select to booq_worker using (true);
create policy club_pause_read on public.club_pause for select to booq_app, booq_worker using (true);
create policy club_status_change_read on public.club_status_change for select to booq_app
  using (app.has_any_role('owner'));

create policy club_feature_owner on public.club_feature for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
create policy club_setting_owner on public.club_setting for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
create policy location_owner on public.location for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
create policy resource_owner on public.resource for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
create policy opening_hours_owner on public.opening_hours for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));

grant select on public.club, public.club_feature, public.club_setting, public.location, public.resource,
  public.opening_hours, public.club_pause, public.club_status_change to booq_app, booq_worker;
-- club.status and slug are changed only through app.set_club_status (T20) and platform routes;
-- the BOOQ-controlled window columns likewise.
grant update (name_th, name_en, legal_name, tax_id, tax_branch, registered_address, payment_option,
              receipt_prefix, default_language, owner_name, owner_phone, owner_line, owner_email)
  on public.club to booq_app;
grant insert, update, delete on public.club_feature, public.club_setting, public.location,
  public.resource, public.opening_hours to booq_app;
