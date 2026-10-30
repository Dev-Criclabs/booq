-- F01-T34: row security on platform.worker_heartbeat, as on every platform table (migration 0008).
-- 0007 created the table before the 0008 helpers existed. BOOQ staff read it (any active staff
-- member; counts only); the worker writes it.
alter table platform.worker_heartbeat enable row level security;
create policy heartbeat_staff_read on platform.worker_heartbeat for select to booq_platform using (platform.staff_role() is not null);
create policy heartbeat_worker_read on platform.worker_heartbeat for select to booq_worker using (true);
create policy heartbeat_worker_insert on platform.worker_heartbeat for insert to booq_worker with check (true);
create policy heartbeat_worker_update on platform.worker_heartbeat for update to booq_worker using (true) with check (true);
