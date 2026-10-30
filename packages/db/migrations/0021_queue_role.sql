-- F01-T33 lane D / DevOps worker proposal (docs/ops/worker.md) / migration 0021: the job queue's own role.
-- booq_queue is NOLOGIN (the operator makes a login user a member, docs/ops) and has no grant on public, app,
-- platform or audit. It owns one schema, graphile_worker, created here by the migrator, so the queue library
-- needs no CREATE on the database. WORKER_QUEUE_URL must be a session pooler or direct connection, never
-- transaction mode (the queue uses session features).
do $$
begin
  begin
    create role booq_queue nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
  exception when duplicate_object then null;
  end;
  alter role booq_queue set timezone = 'Asia/Bangkok';
  -- A non-superuser migrator must be a member to create a schema it owns (hosted Postgres).
  if not (select rolsuper from pg_roles where rolname = current_user) then
    execute format('grant booq_queue to %I', current_user);
  end if;
end $$;

create schema if not exists graphile_worker authorization booq_queue;
