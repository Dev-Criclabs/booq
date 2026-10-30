-- F01 / migration 0007: import staging, exports, data requests, and the worker heartbeat.
-- F01 design 3.2 and 7.4 to 7.7; Requirements: PLAT-06 (AC1, AC10 to AC17), PDPA-01-AC3 to AC7.
-- Decisions D14, D105 (imported players are unclaimed), D104 (personal values in audit pii columns).
-- Raw uploaded files are never stored: a file is parsed into import_row staging rows, and staging
-- goes when the job is confirmed or cancelled, or when it expires (PLAT-06-AC10).

create table public.import_job (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  kind text not null,
  file_name text not null check (file_name <> ''),
  status text not null default 'uploaded',
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_saved integer not null default 0 check (rows_saved >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  created_by uuid not null,
  created_at timestamptz not null default app.now(),
  expires_at timestamptz not null,
  primary key (club_id, id),
  foreign key (club_id, created_by) references public.app_user (club_id, id),
  constraint import_job_kind_values check (kind in ('players', 'packages', 'balances')),
  constraint import_job_status_values check (status in ('uploaded', 'validated', 'failed', 'confirmed', 'cancelled')),
  constraint import_job_expiry check (expires_at > created_at),
  -- all or nothing (PLAT-06-AC2): a confirmed job rejected nothing
  constraint import_job_confirmed_clean check (status <> 'confirmed' or rows_rejected = 0)
);

-- Staging only: the parsed rows of a job that is not finished yet. Raw values are personal data.
create table public.import_row (
  club_id uuid not null,
  job_id uuid not null,
  row_no integer not null check (row_no > 0),
  raw jsonb not null,
  errors jsonb not null default '[]',
  primary key (club_id, job_id, row_no),
  foreign key (club_id, job_id) references public.import_job (club_id, id) on delete cascade
);

-- The staging goes the moment the job is finished or cancelled (PLAT-06-AC10).
create function app.clear_import_staging() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  delete from public.import_row where club_id = new.club_id and job_id = new.id;
  return null;
end $$;
alter function app.clear_import_staging() owner to booq_owner;
revoke all on function app.clear_import_staging() from public;
create trigger import_job_clear_staging after update of status on public.import_job
  for each row when (new.status in ('confirmed', 'cancelled') and old.status is distinct from new.status)
  execute function app.clear_import_staging();

-- Expired jobs lose their staging and become cancelled. Called per club by the housekeeping task
-- inside the club's context (the club is never an argument). Returns the number of jobs cleared.
create function app.sweep_import_staging() returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_n integer;
begin
  if v_club is null then
    raise exception 'sweep_import_staging needs a club in the context' using errcode = 'P0001';
  end if;
  update public.import_job
     set status = 'cancelled'
   where club_id = v_club and status in ('uploaded', 'validated', 'failed') and expires_at <= app.now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
alter function app.sweep_import_staging() owner to booq_owner;
revoke all on function app.sweep_import_staging() from public;
grant execute on function app.sweep_import_staging() to booq_worker;

-- A prepared export of a club's data. BOOQ staff start one through platform.export_request and see
-- only a status; the file is in the private bucket under the club id (PLAT-06-AC11 to AC17).
create table public.data_export (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  kind text not null,
  requested_by_user uuid,
  requested_by_staff uuid,                    -- platform staff id; foreign key added with the platform wiring
  status text not null default 'requested',
  storage_path text,
  expires_at timestamptz,
  row_count integer check (row_count is null or row_count >= 0),
  requested_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, requested_by_user) references public.app_user (club_id, id),
  constraint data_export_kind_values check (kind in ('club', 'customers')),
  constraint data_export_status_values check (status in ('requested', 'running', 'done', 'failed')),
  constraint data_export_one_requester check (num_nonnulls(requested_by_user, requested_by_staff) = 1),
  constraint data_export_done_has_file check (status <> 'done' or (storage_path is not null and expires_at is not null and row_count is not null)),
  constraint data_export_path_in_club check (storage_path is null or storage_path like club_id::text || '/%')
);

-- A player's copy or delete request (PDPA-01-AC3). Handled by owner or front desk.
create table public.data_request (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,
  status text not null default 'requested',
  requested_at timestamptz not null default app.now(),
  handled_by uuid,
  handled_at timestamptz,
  note text,
  primary key (club_id, id),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  foreign key (club_id, handled_by) references public.app_user (club_id, id),
  constraint data_request_kind_values check (kind in ('copy', 'delete')),
  constraint data_request_status_values check (status in ('requested', 'in_progress', 'done', 'declined')),
  constraint data_request_handled_together check ((handled_by is null) = (handled_at is null)),
  constraint data_request_done_is_handled check (status not in ('done', 'declined') or handled_by is not null)
);
create index data_request_open on public.data_request (club_id, requested_at) where status in ('requested', 'in_progress');

-- Ownership, RLS ------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['import_job', 'import_row', 'data_export', 'data_request'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- Imports: the owner only (PLAT-06-AC3). The routes also check; this is the second layer.
create policy import_job_owner on public.import_job for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner') and created_by = app.user_id());
grant select, insert on public.import_job to booq_app;
grant update (status, rows_read, rows_saved, rows_rejected) on public.import_job to booq_app;
create policy import_row_owner on public.import_row for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
grant select, insert, update, delete on public.import_row to booq_app;

-- Exports: the owner reads and starts them; the worker builds them in the club's context.
create policy data_export_owner_read on public.data_export for select to booq_app using (app.has_any_role('owner'));
create policy data_export_owner_start on public.data_export for insert to booq_app
  with check (app.has_any_role('owner') and requested_by_user = app.user_id() and requested_by_staff is null and status = 'requested');
grant select, insert on public.data_export to booq_app;
create policy data_export_worker on public.data_export for select to booq_worker using (true);
create policy data_export_worker_update on public.data_export for update to booq_worker using (true) with check (true);
grant select on public.data_export to booq_worker;
grant update (status, storage_path, expires_at, row_count) on public.data_export to booq_worker;

-- Data requests: a player makes and reads their own; owner and front desk handle them.
create policy data_request_self on public.data_request for insert to booq_app
  with check (user_id = app.user_id() and status = 'requested' and handled_by is null);
create policy data_request_read on public.data_request for select to booq_app
  using (user_id = app.user_id() or app.has_any_role('owner', 'front_desk'));
create policy data_request_handle on public.data_request for update to booq_app
  using (app.has_any_role('owner', 'front_desk')) with check (app.has_any_role('owner', 'front_desk'));
grant select, insert on public.data_request to booq_app;
grant update (status, handled_by, handled_at, note) on public.data_request to booq_app;

-- Audit (F01 design 8): the import event, the export event, the request and its handling. The
-- staging rows are not audited (raw personal data); the request note is a pii column.
select audit.register('public.import_job', array['id']);
select audit.register('public.data_export', array['id']);
select audit.register('public.data_request', array['id'], 'club_id', array['note']);

-- Worker heartbeat (F01-T34; FA 5): one row per task type, counts only, no club and no data. The
-- worker writes it; BOOQ staff read it for the health tile in P1.
create table platform.worker_heartbeat (
  task_name text primary key check (task_name <> ''),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  runs bigint not null default 0 check (runs >= 0),
  failures bigint not null default 0 check (failures >= 0),
  dead_jobs integer not null default 0 check (dead_jobs >= 0),
  lag_seconds integer check (lag_seconds is null or lag_seconds >= 0)
);
alter table platform.worker_heartbeat owner to booq_owner;
revoke all on platform.worker_heartbeat from public;
grant select, insert on platform.worker_heartbeat to booq_worker;
grant update (last_started_at, last_succeeded_at, last_failed_at, runs, failures, dead_jobs, lag_seconds) on platform.worker_heartbeat to booq_worker;
grant select on platform.worker_heartbeat to booq_platform;
