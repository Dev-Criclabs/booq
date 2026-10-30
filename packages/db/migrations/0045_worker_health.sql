-- Migration 0045: counts-only worker health for the external uptime monitor (docs/ops/worker.md "Monitoring").
-- The monitor has no staff session, so the table's staff-only read policy (0014) does not apply to it. This
-- definer function is the only way the platform app reads it without staff: task name, seconds, counts, nothing else.
create function platform.worker_health() returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'task', h.task_name,
           'secondsSinceSuccess', case when h.last_succeeded_at is null then null else floor(extract(epoch from app.now() - h.last_succeeded_at))::int end,
           'secondsSinceStart', case when h.last_started_at is null then null else floor(extract(epoch from app.now() - h.last_started_at))::int end,
           'runs', h.runs, 'failures', h.failures, 'deadJobs', h.dead_jobs, 'lagSeconds', h.lag_seconds
         ) order by h.task_name), '[]'::jsonb)
    from platform.worker_heartbeat h;
$$;
alter function platform.worker_health() owner to booq_owner;
revoke all on function platform.worker_health() from public;
grant execute on function platform.worker_health() to booq_platform;
