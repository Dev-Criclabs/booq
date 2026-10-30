-- F01-T33 lane D request / migration 0020: the worker start script asks which clubs to run for.
-- app.worker_club_ids() returns the ids of Live and Paused clubs and nothing else about them. It takes no
-- argument and needs no club in the context (the worker starts before it has one). booq_worker only.
create function app.worker_club_ids() returns setof uuid
language sql stable security definer set search_path = pg_catalog
as $$ select c.id from public.club c where c.status in ('live', 'paused') order by c.id $$;
alter function app.worker_club_ids() owner to booq_owner;
revoke all on function app.worker_club_ids() from public;
grant execute on function app.worker_club_ids() to booq_worker;
